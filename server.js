// Use 'import' syntax (modern JavaScript)
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

// --- CONFIGURATION ---
const app = express();
const port = 3000;

// This is your secret API key.
// NEVER write the key here. Instead, we use an environment variable.
// In your terminal, you will run the server like this:
// YOUR_API_KEY="sk-123..." node server.js
const API_KEY = process.env.YOUR_API_KEY;

// This is the URL for the AI model API.
// You must replace this with the API endpoint from your "github model".
// (e.g., "https://api.openai.com/v1/chat/completions", "https://api-inference.huggingface.co/models/...")
const MODEL_API_URL = "PASTE_YOUR_MODEL_API_ENDPOINT_HERE";

if (!API_KEY) {
    console.error("Error: YOUR_API_KEY environment variable is not set.");
    process.exit(1);
}

// --- MIDDLEWARE ---
app.use(cors()); // Allows your frontend to talk to this backend
app.use(express.json()); // Allows the server to read JSON from the frontend

// --- THE API ENDPOINT ---
// Your frontend will send requests to this URL: http://localhost:3000/get-skills
app.post('/get-skills', async (req, res) => {
    try {
        // 1. Get the prompt from the frontend's request
        const userPrompt = req.body.prompt;
        
        // --- 2. This is the "Magic Prompt" ---
        // We engineer a prompt to get ALL the data we need in one go.
        const fullPrompt = `
            You are an expert math curriculum assistant.
            A user is asking about the topic: "${userPrompt}"
            
            Your task is to generate a JSON object for this topic with:
            1. The skill name ("name").
            2. The immediate prerequisite skills ("children").
            3. 3-5 practice problems with solutions ("practiceProblems").
            4. A list of 2-3 video tutorial titles ("videoTutorials").
            
            Only respond with a single, valid JSON object. Do not add any text
            before or after the JSON.
            
            The JSON schema must be:
            {
              "name": "Skill Name",
              "children": [
                { "name": "Prerequisite 1" },
                { "name": "Prerequisite 2" }
              ],
              "practiceProblems": [
                { "q": "Problem question...", "s": "Problem solution..." },
                { "q": "Another problem...", "s": "Another solution..." }
              ],
              "videoTutorials": [
                { "title": "Video Title 1", "url": "https://www.youtube.com/..." },
                { "title": "Video Title 2", "url": "https://www.khanacademy.org/..." }
              ]
            }
        `;

        console.log(`Sending prompt to AI for topic: ${userPrompt}`);

        // 3. Send the request to the *actual* AI model
        const response = await fetch(MODEL_API_URL, {
            method: 'POST',
            headers: {
                // This is how you authenticate.
                // It might be "Bearer" or "Basic" or just "x-api-key".
                // Check your model's documentation. "Bearer" is most common.
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                // This part is HIGHLY dependent on your specific model API.
                // This is an example for an OpenAI-compatible model:
                "model": "gpt-4o", // or whatever model name
                "messages": [{ "role": "user", "content": fullPrompt }],
                "response_format": { "type": "json_object" } // Ask for JSON if supported!
                
                // If using Hugging Face, it might just be:
                // "inputs": fullPrompt,
            })
        });

        if (!response.ok) {
            throw new Error(`AI API request failed: ${response.statusText}`);
        }

        // 4. Get the JSON response from the AI
        const aiData = await response.json();
        
        // 5. Extract the clean JSON content
        // This also depends on the AI's response structure.
        // For OpenAI, the JSON string is in choices[0].message.content
        let skillDataJson = aiData.choices[0].message.content;
        
        // For other models, it might just be the response itself:
        // let skillDataJson = aiData; 
        
        // Parse the JSON string into a real object
        const skillData = JSON.parse(skillDataJson);
        
        // 6. Send the clean JSON back to the frontend
        res.json(skillData);

    } catch (error) {
        console.error("Error in /get-skills:", error);
        res.status(500).json({ error: "Failed to fetch skills from AI" });
    }
});

// --- START THE SERVER ---
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log("Remember to set your API key: YOUR_API_KEY='...' node server.js");
});
