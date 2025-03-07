importScripts("/dist/bundle.js");

self.onmessage = function(event) {
    const config = event.data.config;
    const uploadedFile = event.data.uploadedFile;

    try {
        const analysisResult = runAnalysis(config, uploadedFile);
        self.postMessage({ success: true, data: analysisResult });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
