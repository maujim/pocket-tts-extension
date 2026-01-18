let extractedText = "";
let currentSpanIndex = 0;
let currentSpanText = "";
let lastPlayedAudioSize = 0;
let totalSpanCount = 0;
let currentStreamingPlayer = null;

// Streaming WAV Player - plays audio as chunks arrive
class StreamingWavPlayer {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = 0;
    this.numChannels = 0;
    this.headerParsed = false;
    this.headerBuffer = new Uint8Array(44);
    this.headerBytesReceived = 0;
    this.nextStartTime = 0;
    this.minBufferSize = 16384;
    this.pcmData = new Uint8Array(0);
    this.totalBytesReceived = 0;
    this.onComplete = null;
    this.onError = null;
  }

  parseWavHeader(header) {
    const view = new DataView(header.buffer);

    const riff = String.fromCharCode.apply(null, Array.from(header.slice(0, 4)));
    const wave = String.fromCharCode.apply(null, Array.from(header.slice(8, 12)));

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      throw new Error('Invalid WAV file');
    }

    this.numChannels = view.getUint16(22, true);
    this.sampleRate = view.getUint32(24, true);

    this.headerParsed = true;
  }

  appendPcmData(newData) {
    const newBuffer = new Uint8Array(this.pcmData.length + newData.length);
    newBuffer.set(this.pcmData);
    newBuffer.set(newData, this.pcmData.length);
    this.pcmData = newBuffer;
  }

  async tryPlayBuffer() {
    if (!this.headerParsed || this.pcmData.length < this.minBufferSize) {
      return;
    }

    const bytesPerSample = this.numChannels * 2; // 16-bit = 2 bytes
    const samplesToPlay = Math.floor(this.pcmData.length / bytesPerSample);
    const bytesToPlay = samplesToPlay * bytesPerSample;

    if (bytesToPlay === 0) return;

    const dataToPlay = this.pcmData.slice(0, bytesToPlay);
    this.pcmData = this.pcmData.slice(bytesToPlay);

    const audioBuffer = this.audioContext.createBuffer(
      this.numChannels,
      samplesToPlay,
      this.sampleRate
    );

    const int16Data = new Int16Array(dataToPlay.buffer, dataToPlay.byteOffset, samplesToPlay * this.numChannels);

    for (let channel = 0; channel < this.numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < samplesToPlay; i++) {
        channelData[i] = int16Data[i * this.numChannels + channel] / 32768;
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);

    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;

    if (this.pcmData.length >= this.minBufferSize) {
      setTimeout(() => this.tryPlayBuffer(), 10);
    }
  }

  addChunk(chunk) {
    this.totalBytesReceived += chunk.length;

    if (!this.headerParsed) {
      const headerBytesNeeded = 44 - this.headerBytesReceived;
      const bytesToCopy = Math.min(headerBytesNeeded, chunk.length);

      this.headerBuffer.set(
        chunk.slice(0, bytesToCopy),
        this.headerBytesReceived
      );

      this.headerBytesReceived += bytesToCopy;

      if (this.headerBytesReceived >= 44) {
        this.parseWavHeader(this.headerBuffer);

        if (chunk.length > bytesToCopy) {
          this.appendPcmData(chunk.slice(bytesToCopy));
        }
      }
    } else {
      this.appendPcmData(chunk);
    }

    this.tryPlayBuffer();
  }

  complete() {
    if (this.onComplete) {
      this.onComplete(this.totalBytesReceived);
    }
  }

  stop() {
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}

// Update the span info panel
function updateSpanInfo(text, index) {
  currentSpanText = text;
  currentSpanIndex = index;

  const spanInfoDiv = document.getElementById("spanInfo");
  const spanIndexSpan = document.getElementById("spanIndex");
  const spanTextDiv = document.getElementById("spanText");
  const spanLengthSpan = document.getElementById("spanLength");
  const spanWordsSpan = document.getElementById("spanWords");

  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;

  spanIndexSpan.textContent = index;
  spanTextDiv.textContent = preview;
  spanLengthSpan.textContent = text.length;
  spanWordsSpan.textContent = words;
  spanInfoDiv.classList.add("visible");

  // Update pagination
  document.getElementById("currentSpan").textContent = index;
  updatePaginationButtons();
}

// Update pagination button states
function updatePaginationButtons() {
  document.getElementById("prevSpan").disabled = currentSpanIndex <= 0;
  document.getElementById("nextSpan").disabled = currentSpanIndex >= totalSpanCount - 1;
}

// Show pagination and jump controls
function showNavigation() {
  document.getElementById("pagination").style.display = "flex";
  document.getElementById("jumpGroup").style.display = "flex";
  document.getElementById("totalSpans").textContent = totalSpanCount;
}

// Load span by index from content script
async function loadSpan(index) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { type: "getSpanText", index: index },
      (res) => {
        if (res && res.ok) {
          updateSpanInfo(res.text, res.index);
          resolve(true);
        } else {
          document.getElementById("out").textContent = res?.error || "failed to get span";
          resolve(false);
        }
      }
    );
  });
}

// Play audio for given text (streaming)
async function playSpanAudio(text, spanIndex) {
  const out = document.getElementById("out");
  const playFirstBtn = document.getElementById("playFirst");
  const playCurrentBtn = document.getElementById("playCurrent");
  const startTime = performance.now();

  // Stop any currently playing audio
  if (currentStreamingPlayer) {
    currentStreamingPlayer.stop();
    currentStreamingPlayer = null;
  }

  try {
    playFirstBtn.disabled = true;
    playCurrentBtn.disabled = true;
    out.textContent = `connecting to TTS...`;

    const formData = new FormData();
    formData.append('text', text);

    const response = await fetch('http://localhost:8000/tts', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    out.textContent = `generating audio...`;
    const firstAudioTime = performance.now();

    // Create streaming player
    currentStreamingPlayer = new StreamingWavPlayer();
    const player = currentStreamingPlayer;

    player.onComplete = (totalBytes) => {
      lastPlayedAudioSize = totalBytes;

      // Display WAV file size
      const audioInfoDiv = document.getElementById("audioInfo");
      const wavSizeSpan = document.getElementById("wavSize");
      const sizeKB = (totalBytes / 1024).toFixed(2);
      wavSizeSpan.textContent = `${sizeKB} KB (${totalBytes} bytes)`;
      audioInfoDiv.classList.add("visible");

      // Enable estimate button
      document.getElementById("estimate").disabled = false;

      const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
      const firstAudioSecs = ((firstAudioTime - startTime) / 1000).toFixed(2);
      out.textContent = `done (${firstAudioSecs}s to first audio, ${totalTime}s total)`;

      playFirstBtn.disabled = totalSpanCount === 0;
      playCurrentBtn.disabled = !currentSpanText;
      currentStreamingPlayer = null;
    };

    // Read the stream and feed chunks to the player
    const reader = response.body.getReader();
    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            player.complete();
            break;
          }

          if (value) {
            player.addChunk(value);

            // Update status on first audio chunk
            if (!player.firstAudioChunkTime) {
              player.firstAudioChunkTime = performance.now();
              const timeToFirst = ((player.firstAudioChunkTime - firstAudioTime) / 1000).toFixed(2);
              out.textContent = `playing (first audio in ${timeToFirst}s)...`;
            }
          }
        }
      } catch (e) {
        console.error('Error processing stream:', e);
        out.textContent = `stream error: ${e.message}`;
        playFirstBtn.disabled = totalSpanCount === 0;
        playCurrentBtn.disabled = !currentSpanText;
        currentStreamingPlayer = null;
      }
    };

    processStream();

  } catch (err) {
    out.textContent = `TTS failed: ${err.message}`;
    playFirstBtn.disabled = totalSpanCount === 0;
    playCurrentBtn.disabled = !currentSpanText;
    currentStreamingPlayer = null;
  }
}

// Restore UI state from cached data
function restoreFromCache(data) {
  extractedText = data.text;
  totalSpanCount = data.count;

  const out = document.getElementById("out");
  const charCount = extractedText.length;
  const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

  out.textContent = `spans: ${data.count} | words: ${wordCount} | chars: ${charCount}`;

  // Enable buttons
  document.getElementById("copy").disabled = !extractedText;
  document.getElementById("openTab").disabled = !extractedText;
  document.getElementById("playFirst").disabled = totalSpanCount === 0;
  document.getElementById("playCurrent").disabled = true; // Enable after loading span

  // Show navigation and load first span
  if (totalSpanCount > 0) {
    showNavigation();
    loadSpan(0).then(() => {
      document.getElementById("playCurrent").disabled = false;
    });
  }
}

// Check for cached data on popup open
async function init() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "getCache" },
    (res) => {
      if (res && res.cached) {
        restoreFromCache(res.cached);
        document.getElementById("out").textContent += " (cached)";
      }
    }
  );
}

init();

// Extract text button
document.getElementById("run").onclick = async () => {
  const out = document.getElementById("out");

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "count" },
    async (res) => {
      if (!res) {
        out.textContent = "no response, try reloading the page.";
        document.getElementById("copy").disabled = true;
        document.getElementById("openTab").disabled = true;
        document.getElementById("playFirst").disabled = true;
        document.getElementById("playCurrent").disabled = true;
        return;
      }

      extractedText = res.text;
      totalSpanCount = res.count;
      lastPlayedAudioSize = 0;

      const charCount = extractedText.length;
      const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

      out.textContent = `spans: ${res.count} | words: ${wordCount} | chars: ${charCount}`;

      // Enable buttons
      document.getElementById("copy").disabled = !extractedText;
      document.getElementById("openTab").disabled = !extractedText;
      document.getElementById("playFirst").disabled = totalSpanCount === 0;

      // Show navigation and load first span
      if (totalSpanCount > 0) {
        showNavigation();
        await loadSpan(0);
        document.getElementById("playCurrent").disabled = false;
      }
    }
  );
};

// Previous span
document.getElementById("prevSpan").onclick = async () => {
  if (currentSpanIndex > 0) {
    await loadSpan(currentSpanIndex - 1);
  }
};

// Next span
document.getElementById("nextSpan").onclick = async () => {
  if (currentSpanIndex < totalSpanCount - 1) {
    await loadSpan(currentSpanIndex + 1);
  }
};

// Jump to span (scrolls to it in the page)
document.getElementById("jumpToSpan").onclick = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "jumpToSpan", index: currentSpanIndex },
    (res) => {
      if (res && res.ok) {
        document.getElementById("out").textContent = `jumped to span ${currentSpanIndex}`;
      }
    }
  );
};

// Copy to clipboard
document.getElementById("copy").onclick = async () => {
  if (!extractedText) return;

  try {
    await navigator.clipboard.writeText(extractedText);
    const out = document.getElementById("out");
    const originalText = out.textContent;
    out.textContent = "copied to clipboard!";
    setTimeout(() => {
      out.textContent = originalText;
    }, 2000);
  } catch (err) {
    document.getElementById("out").textContent = `copy failed: ${err.message}`;
  }
};

// Open in new tab
document.getElementById("openTab").onclick = () => {
  if (!extractedText) return;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Extracted Text</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      font-family: Georgia, serif;
      font-size: 18px;
      line-height: 1.6;
      color: #333;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <pre>${extractedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>
  `;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
};

// Play first span
document.getElementById("playFirst").onclick = async () => {
  await loadSpan(0);
  await playSpanAudio(currentSpanText, 0);
};

// Play current span
document.getElementById("playCurrent").onclick = async () => {
  if (!currentSpanText) return;
  await playSpanAudio(currentSpanText, currentSpanIndex);
};

// Calculate estimated full audio size
document.getElementById("estimate").onclick = () => {
  const currentSpanChars = parseInt(document.getElementById("spanLength").textContent, 10);

  if (!lastPlayedAudioSize || !currentSpanChars || !extractedText) return;

  const totalChars = extractedText.length;
  const ratio = lastPlayedAudioSize / currentSpanChars;
  const estimatedBytes = totalChars * ratio;
  const estimatedKB = estimatedBytes / 1024;
  const estimatedMB = estimatedKB / 1024;

  const estimateInfoDiv = document.getElementById("estimateInfo");
  document.getElementById("ratioDisplay").textContent = ratio.toFixed(2);
  document.getElementById("totalChars").textContent = totalChars.toLocaleString();

  let sizeText;
  if (estimatedMB >= 1) {
    sizeText = `${estimatedMB.toFixed(2)} MB`;
  } else {
    sizeText = `${estimatedKB.toFixed(2)} KB`;
  }
  sizeText += ` (${Math.round(estimatedBytes).toLocaleString()} bytes)`;

  document.getElementById("estimatedSize").textContent = sizeText;
  estimateInfoDiv.classList.add("visible");
};
