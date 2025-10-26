// --- IMPORTS ---
import { GoogleGenAI } from "@google/genai";
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const app = express();
const port = 3000;

// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- FILE SYSTEM CACHE ---
const JSON_DATA_DIR = path.join(__dirname, 'skill_data');
if (!fs.existsSync(JSON_DATA_DIR)) {
    fs.mkdirSync(JSON_DATA_DIR);
}

// Helper to sanitize topic names for filenames
function sanitizeTopicName(topic) {
    return topic.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
}

// Helper to check if a JSON file for a topic already exists
function jsonFileExists(topic) {
    const filename = sanitizeTopicName(topic) + '.json';
    return fs.existsSync(path.join(JSON_DATA_DIR, filename));
}

// --- API KEY AUTHENTICATION ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("Error: GEMINI_API_KEY environment variable is not set!");
    console.error("Please restart the server using the command:");
    console.error("GEMINI_API_KEY='your-key-here' node server.js");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exit(1);
}

// --- SDK INITIALIZATION ---
let genAI;
try {
    genAI = new GoogleGenAI(API_KEY);
    console.log("SDK Initialized successfully using API Key.");
} catch (sdkError) {
    console.error("CRITICAL ERROR: Failed to initialize GoogleGenAI SDK!", sdkError);
    process.exit(1);
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());


/**
 * Generates ONLY the content (problems, videos) for a skill.
 * Used to fill in missing data for cached files or when AI forgets.
 */
async function generateSkillContent_Gemini(skillName, ancestors = []) {
    const ancestorContext = ancestors.length > 0 ? `It is a sub-topic of ${ancestors.join(' -> ')}.` : '';

    const contentPrompt = `
        Generate practice problems and relevant video tutorials for the skill: "${skillName}".
        ${ancestorContext}

        Format the response as a JSON object with the following structure:
        {
            "practiceProblems": [
                { "q": "Question 1", "s": "Solution 1" },
                { "q": "Question 2", "s": "Solution 2" }
            ],
            "videoTutorials": [
                { "title": "Video Title 1", "url": "https://www.youtube.com/..." },
                { "title": "Video Title 2", "url": "https://www.youtube.com/..." }
            ]
        }
        Provide 3 practice problems and 2-3 video tutorials.
        Only respond with the raw JSON object. Do not add markdown \`\`\`.
    `;

    console.log(`Generating CONTENT ONLY for: ${skillName}`);
    try {
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ parts: [{ text: contentPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        
        let contentJson = result.candidates[0].content.parts[0].text;

        // --- CLEANING LOGIC ---
        if (contentJson.startsWith("```json")) {
            contentJson = contentJson.substring(7); // Remove "```json"
        }
        if (contentJson.endsWith("```")) {
            contentJson = contentJson.substring(0, contentJson.length - 3); // Remove "```"
        }
        contentJson = contentJson.trim();
        // --- END CLEANING LOGIC ---

        return JSON.parse(contentJson);
    } catch (error) {
        console.error(`Error generating content for ${skillName}:`, error);
        return { practiceProblems: [], videoTutorials: [] }; // Return empty if error
    }
}


/**
 * Recursively generates the skill tree, adapted for Gemini.
 * Will recurse until depth == maxDepth.
 */
async function generateSkillTree_Gemini(skillName, ancestors = [], depth = 0, maxDepth = 0) {
    const filename = sanitizeTopicName(skillName) + '.json';
    const filePath = path.join(JSON_DATA_DIR, filename);

    // 1. Check if the skill data already exists (CACHE HIT)
    if (fs.existsSync(filePath)) {
        console.log(`Loading existing data for: ${skillName}`);
        let existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Check if content is missing from cached file.
        if (!existingData.practiceProblems || existingData.practiceProblems.length === 0 ||
            !existingData.videoTutorials || existingData.videoTutorials.length === 0) {
            
            console.log(`Generating missing content for existing skill: ${skillName}`);
            const content = await generateSkillContent_Gemini(skillName, ancestors); 
            existingData = { ...existingData, ...content }; // Merge content
            fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
        }
        
        // --- !! CACHE HYDRATION FIX !! ---
        // Check if children are "stubs" (missing practiceProblems)
        // This is crucial for when we expand a node (like "Barry Allen")
        // that was loaded as a child of a *previous* node (like "The Flash")
        if (depth < maxDepth && existingData.children && existingData.children.length > 0) {
            let isStub = existingData.children[0].practiceProblems === undefined;
            
            if (isStub) {
                console.log(`Cache hit for "${skillName}" has stubs. Hydrating children...`);
                const childPromises = existingData.children.map(async (childStub) => {
                    const childName = childStub.name;
                    const childAncestors = [...ancestors, existingData.name];
                    // Recursively call to get the full child data
                    const childData = await generateSkillTree_Gemini(childName, childAncestors, depth + 1, maxDepth);
                    childData.collapsed = true;
                    return childData;
                });
                
                existingData.children = await Promise.all(childPromises);
                // Save the newly hydrated data back to the file
                fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
                console.log(`Saved hydrated data for "${skillName}"`);
            }
        }
        // --- !! END CACHE HYDRATION FIX !! ---
        
        // Ensure any existing children stubs have 'collapsed: true' for the client
        if (existingData.children && existingData.children.length > 0) {
             existingData.children.forEach(c => {
                c.collapsed = true;
             });
        }

        return existingData;
    }

    // 2. File doesn't exist (CACHE MISS), generate new data
    console.log(`Generating new data for: ${skillName} (depth ${depth}, maxDepth ${maxDepth})`);
    const ancestorContext = ancestors.length > 0 ? `This topic is a sub-skill of: ${ancestors.join(' -> ')}` : '';

    const fullPrompt = `
        You are an expert assistant knowledgeable in various topics.
        A user is asking about the topic: "${skillName}"
        ${ancestorContext}

        Your task is to generate a JSON object breaking down this topic with:
        1. The main topic name ("name").
        2. Immediate sub-topics or prerequisite concepts ("children"). **Limit this to 4-6 children at most.**
        3. 3-5 relevant practice problems, examples, or key points with explanations ("practiceProblems").
        4. A list of 2-3 relevant video tutorial titles or resource links ("videoTutorials").

        Only respond with a single, valid JSON object following the schema below exactly.
        Do not add any text or markdown formatting (like \`\`\`) before or after the JSON.

        The JSON schema must be:
        {
            "name": "Main Topic Name",
            "children": [
                { "name": "Sub-Topic 1" },
                { "name": "Sub-Topic 2" }
            ],
            "practiceProblems": [
                { "q": "Question, Example, or Key Point...", "s": "Solution, Explanation, or Detail..." }
            ],
            "videoTutorials": [
                { "title": "Video/Resource Title 1", "url": "https://www.example.com/..." }
            ]
        }
        
        IMPORTANT:
        - If the topic is a "leaf node" (like "Adding 2+2"), return an empty array for "children".
        - Ensure ALL keys and string values are in double quotes.
    `;

    try {
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        let skillDataJson = result.candidates[0].content.parts[0].text;

        // --- CLEANING LOGIC ---
        if (skillDataJson.startsWith("```json")) {
            skillDataJson = skillDataJson.substring(7);
        }
        if (skillDataJson.endsWith("```")) {
            skillDataJson = skillDataJson.substring(0, skillDataJson.length - 3);
        }
        skillDataJson = skillDataJson.trim();
        // --- END CLEANING LOGIC ---

        let data = JSON.parse(skillDataJson);

        // --- FIX: Check if AI "forgot" the content ---
        if (!data.practiceProblems || data.practiceProblems.length === 0 ||
            !data.videoTutorials || data.videoTutorials.length === 0) {
            
            console.log(`AI response for "${skillName}" was missing content. Fetching content separately...`);
            const content = await generateSkillContent_Gemini(skillName, ancestors); 
            data = { ...data, ...content }; // Merge content into the AI's response
        }
        // --- END OF FIX ---

        // Filter/truncate children
        if (data.children && data.children.length > 0) {
            data.children = data.children.filter(child => {
                const childExists = jsonFileExists(child.name);
                if (childExists) {
                    console.log(`Skipping duplicate child "${child.name}" as JSON data already exists.`);
                }
                return !childExists;
            });
            const maxAllowedChildren = (ancestors.length === 0) ? 6 : 4;
            if (data.children.length > maxAllowedChildren) {
                console.log(`Truncating children for "${skillName}" from ${data.children.length} to ${maxAllowedChildren}`);
                data.children = data.children.slice(0, maxAllowedChildren);
            }
        }

        // --- RECURSIVE PRE-GENERATION BLOCK ---
        if (depth < maxDepth && data.children && data.children.length > 0) {
            console.log(`Pre-generating content for ${data.children.length} children of "${skillName}"...`);
            const newChildren = [];
            for (const childStub of data.children) {
                const childName = childStub.name;
                // Generate the full data for the child
                const childData = await generateSkillTree_Gemini(childName, [...ancestors, data.name], depth + 1, maxDepth);
                childData.collapsed = true; // Add collapsed state for the client
                newChildren.push(childData);
            }
            data.children = newChildren; // Replace stubs with full child data
        } else if (data.children && data.children.length > 0) {
            // At maxDepth, so just add 'collapsed' to the stubs
            data.children.forEach(c => {
                c.collapsed = true;
            });
        }
        // --- END RECURSIVE BLOCK ---

        // Save the complete data (with full children or stubs) to its file
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return data;

    } catch (error) {
        console.error(`Error generating skill tree for ${skillName}:`, error);
        console.error("Full error object:", error);
        
        if (error.response && error.response.promptFeedback) {
             console.error("Prompt Feedback:", JSON.stringify(error.response.promptFeedback, null, 2));
        }
        
        return {
            name: skillName,
            description: `Error generating data for ${skillName}.`,
            children: [],
            practiceProblems: [{q: "Error", s: error.message}],
            videoTutorials: []
        };
    }
}


// --- THE API ENDPOINT ---
app.post('/get-skills', async (req, res) => {
    const { prompt, ancestors = [] } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    try {
        // --- THIS IS THE CORRECT LOGIC ---
        // Always set maxDepth to 1. This tells the server to always
        // pre-generate content for the immediate children of the node
        // being requested, whether it's a new tree OR an expansion.
        const maxDepth = 1;
        // --- END OF LOGIC ---
        
        console.log(`Handling request for "${prompt}", setting maxDepth = ${maxDepth}`);
        const skillTree = await generateSkillTree_Gemini(prompt, ancestors, 0, maxDepth); 
        
        res.json(skillTree);
    } catch (error) {
        console.error("Error in /get-skills:", error.message);
        res.status(500).json({ error: "Failed to fetch skills from AI", details: error.message });
    }
});


// --- START THE SERVER ---
console.log("Attempting to start the server...");
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Caching JSON data in: ${JSON_DATA_DIR}`);
});
