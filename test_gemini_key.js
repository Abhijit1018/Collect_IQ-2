const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function testKey() {
    const key = process.env.GEMINI_API_KEY;
    console.log(`Checking API Key: ${key ? key.substring(0, 5) + '...' : 'UNDEFINED'}`);
    console.log(`Key Length: ${key ? key.length : 0}`);

    if (!key) {
        console.error("ERROR: No API Key found in process.env");
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent("Hello from test script.");
        const response = await result.response;
        console.log("SUCCESS! API responded:", response.text());
    } catch (error) {
        console.error("FAILURE: API Call failed.");
        console.error(error.message);
    }
}

testKey();
