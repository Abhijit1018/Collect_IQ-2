const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("Error: GEMINI_API_KEY not found in .env");
        return;
    }

    const genAI = new GoogleGenerativeAI(key);
    // Using the model manager (if available) or a generic request if needed, 
    // but standard SDK usage doesn't expose listModels directly on the main class easily in all versions.
    // Actually, typical usage for verification is just trying a known stable one like 'gemini-pro'.
    // However, older SDKs expose it via `getGenerativeModel` directly? No.
    // Let's try to check the response of listModels if creating a manager.

    // Note: specific methods depend on SDK version. 
    // If this fails, I'll fallback to 'gemini-pro'.

    try {
        // Current SDK way (v0.1.0+):
        // There isn't a direct helper in the high-level client for listModels in quite the same way as listBuckets.
        // But let's try a direct fetch if we can, or just try 'gemini-pro'.

        // Actually, I will just try to generate content with 'gemini-1.5-flash-latest' and 'gemini-pro' 
        // to see which one succeeds.

        const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.0-pro", "gemini-pro"];

        for (const modelName of modelsToTry) {
            console.log(`Testing model: ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hello");
                const response = await result.response;
                console.log(`✅ SUCCESS: ${modelName} is available.`);
                return; // specific success found
            } catch (err) {
                console.log(`❌ FAILED: ${modelName}`);
                console.log(err.message);
            }
        }

    } catch (error) {
        console.error("Fatal error:", error);
    }
}

listModels();
