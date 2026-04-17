const { ai } = require('./src/ai/genkit');
const { analyzeDrawing } = require('./src/ai/flows/analyze-drawing-flow');

async function test() {
  // This is a placeholder for the PDF data or project ID
  // Since I can't easily get the base64 of the PDF without reading from storage,
  // I'll just check if the model configuration is working.
  console.log("Simulating analyzeDrawing call...");
  
  // I'll try to fetch the project data and see if I can re-run analysis if I had the PDF
  // But wait, I can just try to run a prompt directly to see if the model is responding.
  
  try {
    const response = await ai.generate({
      model: 'googleai/gemini-2.0-flash-exp',
      prompt: 'Return a JSON with a rooms array containing one room named "TEST" with one cabinet "W3042" quantity 1.',
      output: { schema: require('./src/ai/flows/analyze-drawing-flow').AnalyzeDrawingOutputSchema }
    });
    console.log("AI Response:", JSON.stringify(response.output, null, 2));
  } catch (e) {
    console.error("Test Error:", e);
  }
}

// test(); 
// Wait, I need to make sure absolute paths work and imports are correct for commonjs/esm
