// --- IMPORTS ---
import { GoogleGenAI } from "@google/genai";
import express from 'express';
import cors from 'cors';
import path from 'path'; // <-- ADD THIS
import { fileURLToPath } from 'url'; // <-- ADD THIS

// --- CONFIGURATION ---
const app = express();
const port = 3000;

// --- !! NEW: ES Module Path Setup !! ---
// This is necessary to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- API KEY AUTHENTICATION ---
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("Error: GEMINI_API_KEY environment variable is not set!");
    console.error("Please restart the server using the command:");
    console.error("GEMINI_API_KEY='your-key-here' node newServer.js");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exit(1);
}

// --- SDK INITIALIZATION ---
let genAI;
try {
    genAI = new GoogleGenAI(API_KEY);
    console.log("SDK Initialized successfully using API Key.");
} catch (sdkError) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("CRITICAL ERROR: Failed to initialize GoogleGenAI SDK with API Key!");
    console.error("Is the API Key valid?");
    console.error("Error details:", sdkError);
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exit(1);
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- !! NEW: SERVE STATIC FILES !! ---
// Tell Express to serve all files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- !! NEW: DEFINE PAGE ROUTES !! ---
// This ensures that visiting /login serves login.html, etc.

// '/' (root) serves the index.html page (our landing page)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// '/login' serves login.html
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// '/signup' serves signup.html
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// '/app' serves the main application (app.html)
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// --- THE API ENDPOINT (This is unchanged) ---
app.post('/get-skills', async (req, res) => {
    try {
        const userPrompt = req.body.prompt;
        const fullPrompt = `
            You are an expert assistant knowledgeable in various topics like Math, Chess, Coffee, etc.
            A user is asking about the topic: "${userPrompt}"

            Your task is to generate a JSON object breaking down this topic with:
            1. The main topic name ("name").
            2. Immediate sub-topics or prerequisite concepts ("children").
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
                { "q": "Question, Example, or Key Point...", "s": "Solution, Explanation, or Detail..." },
                { "q": "Another example...", "s": "Another explanation..." }
              ],
              "videoTutorials": [
                { "title": "Video/Resource Title 1", "url": "https://www.example.com/..." },
                { "title": "Video/Resource Title 2", "url": "https://www.example.com/..." }
              ]
            }

            VERY IMPORTANT:
            1. Ensure ALL property names (keys) like "name", "children", "q", "s", "title", "url" are enclosed in double quotes.
            2. Ensure ALL string values are enclosed in double quotes and properly escaped (e.g., use \\" for quotes inside strings).
            3. Do not include any unescaped special characters like backslashes (\\) unless part of a valid JSON escape sequence (like \\", \\n). Use plain text for math.
            4. Do not add trailing commas after the last item in an array or object.
            Failure to follow these rules will result in invalid JSON.
        `;

        console.log(`Sending prompt to Gemini SDK for topic: ${userPrompt}`);

        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        console.log("--- Full AI Result (for debugging) ---");
        console.log(JSON.stringify(result, null, 2));
        console.log("-----------------------------------");

        if (!result?.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error("Error: Unexpected AI response structure.");
             if (result?.promptFeedback) {
                 console.error("Prompt Feedback:", JSON.stringify(result.promptFeedback, null, 2));
             }
             if (result?.candidates?.[0]) {
                 console.error("Candidate Finish Reason:", result.candidates[0].finishReason);
                 console.error("Candidate Safety Ratings:", JSON.stringify(result.candidates[0].safetyRatings, null, 2));
             } else {
                 console.error("Complete Result Object:", JSON.stringify(result, null, 2));
             }
            throw new Error("AI response structure was invalid or text content was missing. Check logs.");
        }

        let skillDataJson = result.candidates[0].content.parts[0].text;
        console.log("--- Raw Text from AI (before cleaning) ---");
        console.log(skillDataJson);
        console.log("-----------------------------------------");

        if (skillDataJson.startsWith("```json")) {
            skillDataJson = skillDataJson.substring(7);
        }
        if (skillDataJson.endsWith("```")) {
            skillDataJson = skillDataJson.substring(0, skillDataJson.length - 3);
        }
        skillDataJson = skillDataJson.trim();

        console.log("--- Cleaned JSON Text ---");
        console.log(skillDataJson);
        console.log("------------------------");

        let skillData;
        try {
            skillData = JSON.parse(skillDataJson);
        } catch (parseError) {
            console.error("Error parsing cleaned JSON from AI:", parseError);
            console.error("Cleaned JSON String:", skillDataJson);
            throw new Error(`AI returned invalid JSON even after cleaning: ${parseError.message}`);
        }
        
        res.json(skillData);

    } catch (error) {
        console.error("Error in /get-skills:", error.message);
        res.status(500).json({ error: "Failed to fetch skills from AI", details: error.message });
    }
});

// --- START THE SERVER (This is unchanged) ---
console.log("Attempting to start the server...");

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log("Using API Key for authentication.");
    console.log("Make sure you started the server with GEMINI_API_KEY='...' node newServer.js");
});

console.log(`Server has been told to listen on port ${port}. Waiting for 'Server running...' message.`);