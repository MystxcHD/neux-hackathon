const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 8000;

// --- START: AI Configuration ---
//
// PASTE YOUR API KEY HERE
const API_KEY = "AIzaSyC74VSQ4bue2ugfj_KuFBwH_mnpvuIhE_8"; 
//
if (API_KEY === "YOUR_API_KEY_HERE") {
    console.warn("Please add your Google AI API key to server.js");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
// --- END: AI Configuration ---

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// --- Serve Frontend ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'landing.html'));
});

// --- API Endpoint (Now with Real AI) ---
app.post('/get-skills', async (req, res) => {
    const prompt = req.body.prompt || "";
    if (!prompt) {
        return res.status(400).json({ details: "Prompt is required." });
    }

    console.log(`Received prompt: "${prompt}"`);

    // --- This is the instruction for the AI ---
    // It asks the AI to act as a data generator and return a JSON
    // in the *exact* format your index.html chart expects.
    const aiPrompt = `
        You are an API that generates knowledge graphs.
        The user wants to learn about: "${prompt}".
        
        Generate a JSON object representing a knowledge graph.
        The main topic should be the root.
        Include 'children' for sub-topics.
        For at least a few sub-topics (where relevant), include:
        1. 'practiceProblems': an array of {q: "question", s: "solution"}
        2. 'videoTutorials': an array of {title: "video title", url: "https://www.youtube.com/watch?v=example"}

        RULES:
        - The root node MUST have the name "${prompt}".
        - You MUST respond with ONLY the raw JSON object, no other text or markdown.
        - Ensure the JSON is valid.
        - 'children' should be an array of objects.

        Example of a valid "Derivatives" node:
        {
          "name": "Derivatives",
          "practiceProblems": [
            {"q": "What is the power rule?", "s": "d/dx(x^n) = nx^(n-1)"}
          ],
          "videoTutorials": [
            {"title": "Intro to Derivatives", "url": "https://www.youtube.com/watch?v=example"}
          ],
          "children": [
            {"name": "Power Rule"},
            {"name": "Product Rule"}
          ]
        }

        Generate the graph for "${prompt}" now.
    `;

    try {
        const result = await model.generateContent(aiPrompt);
        const response = await result.response;
        let text = await response.text();

        // Clean the response to make sure it's just the JSON
        text = text.trim().replace(/^```json\n/, '').replace(/\n```$/, '');

        console.log("AI Response (raw):", text);

        // Parse the JSON text from the AI
        const jsonData = JSON.parse(text);
        
        // Send the AI-generated JSON to index.html
        res.json(jsonData);

    } catch (error) {
        console.error("AI Generation Error:", error);
        res.status(500).json({ details: "Failed to generate data from AI.", error: error.message });
    }
});

// --- Start the server ---
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Serving frontend and REAL backend from one server.');
});