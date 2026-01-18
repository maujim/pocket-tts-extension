// Background service worker for handling HTTP requests to localhost
// Content scripts on HTTPS pages cannot make HTTP requests due to mixed content blocking
// This proxy allows them to fetch from http://localhost:8000

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetchTTS") {
    // Proxy the fetch request to localhost
    // Use FormData to match the original request format
    const formData = new FormData();
    formData.append('text', msg.text);

    fetch(`http://localhost:8000/tts`, {
      method: 'POST',
      body: formData
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Stream the response back to content script
        const reader = response.body.getReader();

        // Send the response headers first
        sendResponse({ type: 'start', ok: true });

        // Then stream chunks
        const readChunk = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              // Send end signal
              chrome.tabs.sendMessage(sender.tab.id, { type: 'ttsChunk', done: true });
              return;
            }
            // Send chunk to content script
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'ttsChunk',
              done: false,
              value: Array.from(value) // Convert Uint8Array to regular array for message passing
            });
            readChunk();
          });
        };
        readChunk();
      })
      .catch(error => {
        sendResponse({ type: 'error', error: error.message });
      });

    return true; // Keep message channel open for async response
  }
});
