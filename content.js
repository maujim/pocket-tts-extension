// Cache for extracted data (persists while tab is open, cleared on reload)
let cachedData = null;
let cachedGroups = null;

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

  async pause() {
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend();
    }
  }

  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
}

// State for audio playback
let currentPlayer = null;
let isPlaying = false;
let currentSpanIndex = 0;
let totalSpans = 0;
let spanTexts = []; // Array of span texts to play sequentially
let currentChunkListener = null; // Track current listener for cleanup

// Extract article text and prepare for sequential playback
function extractSpanTexts() {
  const groups = groupSpansByParent();
  if (groups.length === 0) return null;

  totalSpans = groups.length;
  // Return array of texts instead of joined string
  return groups.map(g => g.text);
}

// Clean up playback state and listeners
function cleanupPlayback() {
  if (currentChunkListener) {
    chrome.runtime.onMessage.removeListener(currentChunkListener);
    currentChunkListener = null;
  }
  if (currentPlayer) {
    currentPlayer.stop();
    currentPlayer = null;
  }
  isPlaying = false;
}

// Play a single span's audio and return a promise that resolves when done
async function playSingleSpan(text, spanIndex) {
  return new Promise((resolve, reject) => {
    const player = new StreamingWavPlayer();
    currentPlayer = player;

    // Update UI to show current span
    currentSpanIndex = spanIndex;
    updateNarratorUI(currentSpanIndex, totalSpans, isPlaying);

    player.onComplete = () => {
      resolve();
    };

    player.onError = (error) => {
      reject(error);
    };

    // Set up listener for streaming chunks from background script
    const chunkListener = (msg) => {
      if (msg.type === 'ttsChunk') {
        if (msg.done) {
          player.complete();
        } else if (msg.value) {
          player.addChunk(new Uint8Array(msg.value));
        }
      }
    };

    chrome.runtime.onMessage.addListener(chunkListener);
    currentChunkListener = chunkListener;

    // Clean up listener after playback completes
    const originalOnComplete = player.onComplete;
    player.onComplete = (totalBytes) => {
      chrome.runtime.onMessage.removeListener(chunkListener);
      currentChunkListener = null;
      if (originalOnComplete) originalOnComplete(totalBytes);
    };

    // Start the TTS fetch via background script
    chrome.runtime.sendMessage(
      { type: "fetchTTS", text: text },
      (response) => {
        if (chrome.runtime.lastError) {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response.type === 'error') {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error(response.error));
        } else if (!response.ok) {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error(`API error: ${response.status}`));
        }
        // If successful, the chunkListener will handle the streaming
      }
    );
  });
}

// Play all spans sequentially with proper UI updates
async function playSpansSequentially(spans, startOffset = 0) {
  try {
    for (let i = 0; i < spans.length; i++) {
      if (!isPlaying) {
        // User stopped playback
        break;
      }
      // Use startOffset + i + 1 for 1-based display index
      await playSingleSpan(spans[i], startOffset + i + 1);
    }

    // All spans completed or playback was stopped
    if (isPlaying && currentSpanIndex === totalSpans) {
      // Natural completion
      isPlaying = false;
      updateNarratorUI(totalSpans, totalSpans, false);
    }
    currentPlayer = null;
  } catch (error) {
    console.error('Sequential playback error:', error);
    cleanupPlayback();
    updateNarratorUI(currentSpanIndex, totalSpans, false);
  }
}

// Update the UI status and progress based on span position
function updateNarratorUI(currentSpan, totalSpans, playing = false) {
  const statusEl = document.getElementById('narrator-status');
  const progressEl = document.getElementById('narrator-progress-bar');
  const playBtn = document.getElementById('narrator-play');

  const statusText = totalSpans > 0
    ? `Span ${currentSpan}/${totalSpans}`
    : 'Span 0/0';
  const progress = totalSpans > 0
    ? currentSpan / totalSpans
    : 0;

  if (statusEl) statusEl.textContent = statusText;
  if (progressEl) progressEl.style.width = `${progress * 100}%`;

  if (playBtn) {
    if (playing) {
      playBtn.classList.add('playing');
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: white;">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
      `;
    } else {
      playBtn.classList.remove('playing');
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: white;">
          <path d="M8 5v14l11-7z"/>
        </svg>
      `;
    }
  }
}

// Group spans by their common container ancestor
// Climbs up past nested span wrappers to find the actual paragraph container
function groupSpansByParent() {
  const selector = 'span[data-text="true"]';
  const spans = Array.from(document.querySelectorAll(selector));

  const parentMap = new Map(); // container element -> array of spans

  // For each span, find its container (climb past nested span wrappers)
  for (const span of spans) {
    let container = span.parentElement;

    // Climb up past nested spans to find the real container
    while (container && container.tagName === 'SPAN') {
      container = container.parentElement;
    }

    if (!container) continue;

    if (!parentMap.has(container)) {
      parentMap.set(container, []);
    }
    parentMap.get(container).push(span);
  }

  // Convert map to array of groups, preserving document order
  const allContainers = Array.from(parentMap.keys());

  // Sort containers by document order (position of first child)
  allContainers.sort((a, b) => {
    const aFirst = parentMap.get(a)[0];
    const bFirst = parentMap.get(b)[0];
    const position = aFirst.compareDocumentPosition(bFirst);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  // Build groups
  const groups = [];
  for (const container of allContainers) {
    const containerSpans = parentMap.get(container);
    // Sort spans within this container by document order
    containerSpans.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // Combine text from all spans in this container
    const combinedText = containerSpans
      .map(s => s.textContent)
      .join('');

    groups.push({
      parent: container,
      spans: containerSpans,
      text: combinedText,
      spanCount: containerSpans.length
    });
  }

  return groups;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Return cached data if available
  if (msg.type === "getCache") {
    sendResponse({ cached: cachedData });
    return true;
  }

  // Clear cache
  if (msg.type === "clearCache") {
    cachedData = null;
    cachedGroups = null;
    sendResponse({ ok: true });
    return true;
  }

  // Get text of a specific group by index
  if (msg.type === "getSpanText") {
    const groups = groupSpansByParent();
    const index = msg.index;

    if (index < 0 || index >= groups.length) {
      sendResponse({ ok: false, error: `Invalid index: ${index}. Valid range: 0-${groups.length - 1}` });
      return true;
    }

    const group = groups[index];
    sendResponse({
      ok: true,
      index: index,
      text: group.text,
      spanCount: group.spanCount,
      totalSpans: groups.length
    });
    return true;
  }

  // Jump to (scroll to) a specific group
  if (msg.type === "jumpToSpan") {
    const groups = groupSpansByParent();
    const index = msg.index;

    if (index < 0 || index >= groups.length) {
      sendResponse({ ok: false, error: `Invalid index: ${index}` });
      return true;
    }

    const group = groups[index];
    // Scroll to the first span in the group
    if (group.spans.length > 0) {
      group.spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    sendResponse({ ok: true, index: index });
    return true;
  }

  if (msg.type !== "count") return;

  // Build groups and return summary
  const groups = groupSpansByParent();
  const rawSpans = document.querySelectorAll('span[data-text="true"]');

  // Collect all text from the groups
  const fullText = groups
    .map(g => g.text)
    .join(' ');

  const firstGroupText = groups.length > 0 ? groups[0].text : '';

  // Cache the result
  cachedData = {
    count: groups.length,
    rawSpanCount: rawSpans.length,
    text: fullText,
    firstSpanText: firstGroupText
  };

  sendResponse(cachedData);
  return true;
});

// Inject narrator UI into the Twitter sidebar
// Surgically edits Twitter's DOM by cloning and modifying their sidebar structure
function setupNarratorUI() {
  // Only run on Twitter/X article pages (pages with extractable text)
  const hasArticleText = document.querySelector('span[data-text="true"]');
  if (!hasArticleText) {
    return;
  }

  // Check if narrator UI already exists
  if (document.getElementById('narrator-ui')) {
    return;
  }

  // Try to find the sidebar by aria-label first, then fallback to first <aside>
  const sidebar = document.querySelector('aside[aria-label="Relevant people"]') ||
                  document.querySelector('aside');

  if (!sidebar) {
    return;
  }

  // Clone the ENTIRE sidebar element
  const clonedSidebar = sidebar.cloneNode(true);

  // Change the aria-label from "Relevant people" to "Article Narrator"
  clonedSidebar.setAttribute('aria-label', 'Article Narrator');

  // Find the header div that contains "Relevant people" text and change it to "Article Narrator"
  const headerDiv = clonedSidebar.querySelector('div[dir="ltr"]');
  if (headerDiv) {
    headerDiv.textContent = 'Article Narrator';
  } else {
    // Fallback: find any heading or div with the text
    const allTextNodes = clonedSidebar.querySelectorAll('*');
    for (const node of allTextNodes) {
      if (node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE) {
        if (node.textContent === 'Relevant people') {
          node.textContent = 'Article Narrator';
          break;
        }
      }
    }
  }

  // Find the <ul> inside the cloned sidebar
  const ul = clonedSidebar.querySelector('ul');
  if (!ul) {
    return;
  }

  // Clear the existing <li> items from the <ul>
  while (ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }

  // Create new <li> items that MATCH Twitter's existing <li> structure
  // We'll copy the structure from an existing list item in the original sidebar
  const originalLi = sidebar.querySelector('li');
  let newLi;

  if (originalLi) {
    // Clone the original <li> to get all the correct classes and structure
    newLi = originalLi.cloneNode(true);
    // Clear its contents
    while (newLi.firstChild) {
      newLi.removeChild(newLi.firstChild);
    }
  } else {
    // Fallback: create a basic <li> with Twitter's common classes
    newLi = document.createElement('li');
    newLi.setAttribute('role', 'listitem');
  }

  // Build the narrator controls using Twitter's existing structure
  // Create the inner container structure that Twitter uses
  const innerContainer = document.createElement('div');
  // Copy classes from a typical Twitter sidebar item container
  innerContainer.className = 'css-1dbjc4n r-1loqt21 r-1otgn73';

  // Create the avatar area (left side) - where we'll put the play/pause button
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'css-1dbjc4n r-1dgelrq r-1ny4l3l r-1w6e6rj r-1udh08x r-l4nmg1';

  // Create the play/pause button using Twitter's button styles
  const playButton = document.createElement('div');
  playButton.id = 'narrator-play';
  playButton.setAttribute('role', 'button');
  playButton.className = 'css-18t94o4 css-1dbjc4n r-kdyh1x r-1loqt21 r-1ljd8xs r-1ljd8xs r-13qz1uu r-1otgn73 r-1i6wzkk r-lrvibr';
  playButton.style.cursor = 'pointer';
  playButton.style.backgroundColor = 'rgb(15, 20, 25)';
  playButton.style.borderRadius = '9999px';
  playButton.style.padding = '12px';
  playButton.style.display = 'flex';
  playButton.style.alignItems = 'center';
  playButton.style.justifyContent = 'center';
  playButton.title = 'Play/Pause';

  // Add the play icon SVG
  playButton.innerHTML = `
    <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: white;">
      <path d="M8 5v14l11-7z"/>
    </svg>
  `;

  avatarDiv.appendChild(playButton);

  // Create the content area (right side) - title, status, progress
  const contentDiv = document.createElement('div');
  contentDiv.className = 'css-1dbjc4n r-18u37iz r-13qz1uu r-1w6e6rj r-l4nmg1';

  // Create the title text
  const titleDiv = document.createElement('div');
  titleDiv.className = 'css-901oao r-1awozwy r-6koalj r-18u37iz r-1q142lx r-1fneopy r-1i6wzkk r-l4nmg1';
  titleDiv.style.fontSize = '15px';
  titleDiv.style.fontWeight = '700';
  titleDiv.textContent = 'Article Narrator';

  // Create the status text
  const statusDiv = document.createElement('div');
  statusDiv.id = 'narrator-status';
  statusDiv.className = 'css-901oao r-1awozwy r-6koalj r-18u37iz r-1q142lx r-1fneopy r-1i6wzkk r-l4nmg1';
  statusDiv.style.fontSize = '15px';
  statusDiv.style.color = 'rgb(113, 118, 123)';
  statusDiv.textContent = 'Span 0/0';

  // Create the progress bar container
  const progressContainer = document.createElement('div');
  progressContainer.className = 'css-1dbjc4n r-1awozwy r-18u37iz r-1w6e6rj r-1udh08x r-l4nmg1';
  progressContainer.style.marginTop = '8px';
  progressContainer.style.width = '100%';

  const progressBg = document.createElement('div');
  progressBg.className = 'css-1dbjc4n r-1awozwy r-13awgt0 r-1ljd8xs r-l4nmg1';
  progressBg.style.backgroundColor = 'rgb(40, 44, 50)';
  progressBg.style.borderRadius = '9999px';
  progressBg.style.height = '4px';
  progressBg.style.width = '100%';
  progressBg.style.overflow = 'hidden';

  const progressBar = document.createElement('div');
  progressBar.id = 'narrator-progress-bar';
  progressBar.className = 'css-1dbjc4n r-13awgt0 r-1ljd8xs';
  progressBar.style.backgroundColor = 'rgb(29, 155, 240)';
  progressBar.style.height = '100%';
  progressBar.style.width = '0%';
  progressBar.style.transition = 'width 0.3s ease';

  progressBg.appendChild(progressBar);
  progressContainer.appendChild(progressBg);

  // Assemble the content
  contentDiv.appendChild(titleDiv);
  contentDiv.appendChild(statusDiv);
  contentDiv.appendChild(progressContainer);

  // Assemble the inner container
  innerContainer.appendChild(avatarDiv);
  innerContainer.appendChild(contentDiv);

  // Create a wrapper div for the narrator UI (for identification)
  const narratorUiWrapper = document.createElement('div');
  narratorUiWrapper.id = 'narrator-ui';
  narratorUiWrapper.appendChild(innerContainer);

  // Put everything into the <li>
  newLi.appendChild(narratorUiWrapper);

  // Add the <li> to the <ul>
  ul.appendChild(newLi);

  // Insert the cloned sidebar AFTER the original sidebar
  // This keeps both sidebars - original "Relevant people" AND new "Narrator"
  if (sidebar.nextSibling) {
    sidebar.parentNode.insertBefore(clonedSidebar, sidebar.nextSibling);
  } else {
    sidebar.parentNode.appendChild(clonedSidebar);
  }

  console.log('Narrator UI: Injected successfully, stacked after original sidebar');
}

// Use a MutationObserver to handle Twitter's dynamic content loading
const observer = new MutationObserver(() => {
  setupNarratorUI();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also run on initial load
setupNarratorUI();

// Handle play/pause button clicks
document.addEventListener('click', async (e) => {
  const playBtn = e.target.closest('#narrator-play');
  if (!playBtn) return;

  if (isPlaying) {
    // Stop playback
    cleanupPlayback();
    updateNarratorUI(currentSpanIndex, totalSpans, false);
    // Reset to beginning so next play starts from span 1
    currentSpanIndex = 0;
  } else {
    // Start playback - extract span texts and play sequentially
    spanTexts = extractSpanTexts();
    if (!spanTexts || spanTexts.length === 0) {
      updateNarratorUI(0, 0, false);
      return;
    }

    isPlaying = true;
    // Start from current span index (allows resuming if paused mid-article)
    const startIndex = currentSpanIndex > 0 ? currentSpanIndex - 1 : 0;
    const remainingSpans = spanTexts.slice(startIndex);

    // Update UI immediately to show playing state
    updateNarratorUI(startIndex + 1, totalSpans, true);

    // Start sequential playback with offset for correct numbering
    playSpansSequentially(remainingSpans, startIndex);
  }
});
