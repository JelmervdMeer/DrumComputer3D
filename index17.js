import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";

/* ===========================
   CONFIG / CONSTANTS
   =========================== */
const ACTIVE_COLOR = 0xffff00;      // blijvend: geel
const INACTIVE_COLOR = 0x222222;   // blijvend: donker
const SAMPLE_ASSIGN_COLOR = 0x00ffff;

const ROWS = 9;
const COLS = 16;

/* ===========================
   GLOBAL STATE
   =========================== */
// 3D objects
let drumkit = null;
let pads = []; // lijst van pad-meshes
let screenDisplay = null;
let wfDisplay3D = null;

// control-knoppen in model (kunnen null zijn tot model geladen is)
let startButton3D = null, stopButton3D = null;
let startRecButton3D = null, stopRecButton3D = null;
let saveButton3D = null, loadButton3D = null;
let lib1Button3D = null, lib2Button3D = null, lib3Button3D = null;
let sub16Button3D = null, sub8Button3D = null, sub4Button3D = null;
const subdivisionButtons = [];

// audio / samples
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const gainNode = audioContext.createGain();
gainNode.gain.value = 0.8;
gainNode.connect(audioContext.destination);

const destination = audioContext.createMediaStreamDestination();
gainNode.connect(destination);

const analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;
gainNode.connect(analyser);

const mediaRecorder = new MediaRecorder(destination.stream);
let audioChunks = [];
mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
mediaRecorder.onstop = () => {
  const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
  const audioUrl = URL.createObjectURL(audioBlob);
  const link = document.createElement('a');
  link.href = audioUrl;
  link.download = 'beat.wav';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// sample libraries (gebruik URLs via import.meta.url)
const libraries = {
  lib1: [
    new URL('./audio/hihat1.wav', import.meta.url).href,
    new URL('./audio/crash1.wav', import.meta.url).href,
    new URL('./audio/ride1.wav', import.meta.url).href,
    new URL('./audio/rocktoms1.wav', import.meta.url).href,
    new URL('./audio/snaredrum1.wav', import.meta.url).href,
    new URL('./audio/floortom1.wav', import.meta.url).href,
    new URL('./audio/basedrum2.wav', import.meta.url).href,
    new URL('./audio/Sample1.wav', import.meta.url).href,
    new URL('./audio/Sample2.wav', import.meta.url).href,
  ],
  lib2: [
    new URL('./audio/hihat2.wav', import.meta.url).href,
    new URL('./audio/crash2.wav', import.meta.url).href,
    new URL('./audio/ride2.wav', import.meta.url).href,
    new URL('./audio/rocktoms1.wav', import.meta.url).href,
    new URL('./audio/snaredrum2.wav', import.meta.url).href,
    new URL('./audio/floortom2.wav', import.meta.url).href,
    new URL('./audio/basedrum3.wav', import.meta.url).href,
    new URL('./audio/Sample3.wav', import.meta.url).href,
    new URL('./audio/Sample4.wav', import.meta.url).href,
  ],
  lib3: [
    new URL('./audio/hihat2.wav', import.meta.url).href,
    new URL('./audio/crash2.wav', import.meta.url).href,
    new URL('./audio/ride2.wav', import.meta.url).href,
    new URL('./audio/rocktoms1.wav', import.meta.url).href,
    new URL('./audio/snaredrum3.wav', import.meta.url).href,
    new URL('./audio/floortom3.wav', import.meta.url).href,
    new URL('./audio/basedrum3.wav', import.meta.url).href,
    new URL('./audio/Sample3.wav', import.meta.url).href,
    new URL('./audio/Sample4.wav', import.meta.url).href,
  ],
};

let instrumentFiles = libraries.lib1.slice(); // huidige library (array)
const audioBuffers = {}; // key: filename (last segment) -> AudioBuffer
let samplesLoaded = false;

// sequence / playback
let subdivisionOptions = [4, 8, 16];
let subdivisionIndex = 2; // default: index voor 16
let subdivision = subdivisionOptions[subdivisionIndex];
let tempo = 120;
let stepDuration = 0;
let currentStep = 0;
let isPlaying = false;

// UI / input
let inputMode = null; // 'save'|'load'|null
let inputBuffer = "";
let awaitingInput = false;

// misc
const particles = [];
let pulse = 0;

/* ===========================
   THREE SCENE SETUP
   =========================== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222244);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// nicer renderer defaults
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
renderer.outputEncoding = THREE.sRGBEncoding;

// lights
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(5, 10, 5);
scene.add(light);
const ambientLight = new THREE.AmbientLight(0xffffff, 2);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/* ===========================
   INFO DISPLAY (3D canvas texture)
   =========================== */
const infoCanvas = document.createElement("canvas");
const infoCtx = infoCanvas.getContext("2d");
const infoTexture = new THREE.CanvasTexture(infoCanvas);
const infoMaterial = new THREE.MeshBasicMaterial({ map: infoTexture, side: THREE.DoubleSide });

function resizeInfoCanvas() {
  const dpr = window.devicePixelRatio || 1;
  infoCanvas.width = 512 * dpr;
  infoCanvas.height = 128 * dpr;
  infoCtx.setTransform(1, 0, 0, 1, 0, 0); // reset
  infoCtx.scale(dpr, dpr);
  infoTexture.needsUpdate = true;
}
resizeInfoCanvas();

function updateInfoDisplay(text) {
  // if no screenDisplay yet, fallback to console and return
  if (!screenDisplay || !screenDisplay.userData?.ctx) {
    console.log("ℹ️ Display (fallback):", text);
    return;
  }

  const ctx = screenDisplay.userData.ctx;
  const texture = screenDisplay.userData.texture;
  const canvas = ctx.canvas;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "lime";
  ctx.font = "bold 40px 'Orbitron', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = canvas.width * 0.9;
  const lineHeight = 46;
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const testLine = currentLine + (currentLine ? " " : "") + words[i];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const totalHeight = lines.length * lineHeight;
  let y = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;

  lines.forEach(line => {
    ctx.fillText(line, canvas.width / 2, y);
    y += lineHeight;
  });

  texture.needsUpdate = true;
}

/* ===========================
   WAVEFORM DISPLAY
   =========================== */
const wfCanvas = document.createElement("canvas");
wfCanvas.width = 512;
wfCanvas.height = 128;
const wfCtx = wfCanvas.getContext("2d");
const wfTexture = new THREE.CanvasTexture(wfCanvas);
wfTexture.minFilter = THREE.LinearFilter;
wfTexture.magFilter = THREE.LinearFilter;
wfTexture.flipY = true;
const wfMaterial = new THREE.MeshBasicMaterial({ map: wfTexture });

const waveformData = new Uint8Array(analyser.fftSize);

function updateWaveformDisplay() {
  analyser.getByteTimeDomainData(waveformData);
  const w = wfCanvas.width;
  const h = wfCanvas.height;
  wfCtx.clearRect(0, 0, w, h);

  let sum = 0;
  for (let i = 0; i < waveformData.length; i++) {
    const v = (waveformData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / waveformData.length);
  pulse = Math.max(pulse * 0.92, rms * 3.5);

  const bgBrightness = Math.min(255, 40 + pulse * 180);
  wfCtx.fillStyle = `rgb(0, ${bgBrightness}, 0)`;
  wfCtx.fillRect(0, 0, w, h);

  wfCtx.lineWidth = 2.2;
  wfCtx.strokeStyle = "black";
  wfCtx.beginPath();
  const sliceWidth = w / waveformData.length;
  let x = 0;
  for (let i = 0; i < waveformData.length; i++) {
    const v = waveformData[i] / 128.0;
    const y = (v * h) / 2;
    if (i === 0) wfCtx.moveTo(x, y); else wfCtx.lineTo(x, y);
    x += sliceWidth;
  }
  wfCtx.stroke();

  wfTexture.needsUpdate = true;

  if (wfDisplay3D && wfDisplay3D.material) {
    const brightness = 0.2 + pulse * 0.8;
    wfDisplay3D.material.color.setRGB(0, brightness, 0);
  }
}

function setupWaveformDisplay() {
  wfDisplay3D = scene.getObjectByName("wfDisplay");
  if (wfDisplay3D) {
    console.log("🎛️ wfDisplay gevonden in model – texture gekoppeld");
    wfDisplay3D.material = wfMaterial;
  } else {
    console.log("⚠️ Geen wfDisplay gevonden – maak tijdelijk scherm aan");
    const geo = new THREE.PlaneGeometry(2, 0.5);
    wfDisplay3D = new THREE.Mesh(geo, wfMaterial);
    wfDisplay3D.position.set(0, 1.5, 0);
    scene.add(wfDisplay3D);
  }
}

/* ===========================
   SCENE / MODEL LOADING
   =========================== */
const loader = new GLTFLoader();
const modelPath = new URL('./drummachine3.glb', import.meta.url).href;

loader.load(modelPath, (gltf) => {
  drumkit = gltf.scene;
  scene.add(drumkit);
  console.log("🔁 Model geladen");

  // helper: find first mesh child of a parent
  function findMeshForParent(parentName) {
    const parent = drumkit.getObjectByName(parentName);
    if (!parent) return null;
    return parent.children.find(c => c.isMesh) || parent;
  }
/*
startButton3D = findMeshForParent("StartButton");
console.log("StartButton: gevonden", startButton3D);

stopButton3D  = findMeshForParent("StopButton");
console.log("StopButton: gevonden", stopButton3D);
*/
  // LIB BUTTONS (may be meshes or parents)
 /* lib1Button3D = findMeshForParent("lib1Button");
  console.log("lib1Button3D:", lib1Button3D);
  lib2Button3D = findMeshForParent("lib2Button");
  lib3Button3D = findMeshForParent("lib3Button");
*/
// START / STOP SEQUENCE BUTTONS
 /*startButton3D = scene.getObjectByName("StartButton");
  console.log("StartButton: gevonden", startButton3D);
  stopButton3D  = scene.getObjectByName("StopButton");
  console.log("StopButton: gevonden", stopButton3D);*/
 function getChildMeshOf(name) {
  const parent = drumkit.getObjectByName(name);
  if (!parent) return null;
  // zoek het eerste kind dat een mesh is
  const meshChild = parent.children.find(c => c.isMesh);
  return meshChild || null;
}

startButton3D = getChildMeshOf("StartButton");
stopButton3D  = getChildMeshOf("StopButton");
lib1Button3D = getChildMeshOf("lib1Button");
lib2Button3D = getChildMeshOf("lib2Button");
lib3Button3D = getChildMeshOf("lib3Button");
startRecButton3D = getChildMeshOf("startRec");
stopRecButton3D = getChildMeshOf("stopRec");
saveButton3D = getChildMeshOf("saveSequence");
loadButton3D = getChildMeshOf("loadSequence");
sub16Button3D = getChildMeshOf("sub16Button");
sub8Button3D = getChildMeshOf("sub8Button");
sub4Button3D = getChildMeshOf("sub4Button");

console.log("🟢 StartButton child mesh:", startButton3D);
console.log("🔴 StopButton child mesh:", stopButton3D) ;
console.log("🔵 lib1Button child mesh:", lib1Button3D);
console.log("� lib2Button child mesh:", lib2Button3D);
console.log("� lib3Button child mesh:", lib3Button3D);
console.log("🟠 startRecButton child mesh:", startRecButton3D);
console.log("🟣 stopRecButton child mesh:", stopRecButton3D);
console.log("🟡 saveButton child mesh:", saveButton3D);
console.log("🟤 loadButton child mesh:", loadButton3D);
console.log("⚫ sub16Button child mesh:", sub16Button3D);
console.log("⚪ sub8Button child mesh:", sub8Button3D);
console.log("⚫ sub4Button child mesh:", sub4Button3D);
 /* [lib1Button3D, lib2Button3D, lib3Button3D].forEach(btn => {
    if (!btn) return;
    btn.material = btn.material.clone();
    btn.material.color.set(0x222222);
    btn.userData = btn.userData || {};
  });*/

  // traverse model to find pads + named controls + screen display
  const processedParents = new Set();
  drumkit.traverse(child => {
    if (!child.isMesh) return;

    const parent = child.parent;
    const possibleNames = [child.name, parent?.name].filter(Boolean);

    // map named control meshes
    /*for (const name of possibleNames) {
      switch (name) {
        case "StartButton": startButton3D = child; break;
        case "StopButton": stopButton3D = child; break;
        case "startRec": startRecButton3D = child; break;
        case "stopRec": stopRecButton3D = child; break;
        case "saveSequence": saveButton3D = child; break;
        case "loadSequence": loadButton3D = child; break;
        case "subdivisionKnop": /* optional break; */
      /*  case "lib1Button": lib1Button3D = child; break;
        case "lib2Button": lib2Button3D = child; break;
        case "lib3Button": lib3Button3D = child; break;
        case "sub16Button": sub16Button3D = child; break;
        case "sub8Button": sub8Button3D = child; break;
        case "sub4Button": sub4Button3D = child; break;

      }
    }*/

    // pads: parent name like pad_R_C or pad_R-C
    if (parent && parent.name) {
      const m = parent.name.match(/^pad[_\-]?0?(\d+)[_\-]?0?(\d+)/i);
      if (m && !processedParents.has(parent.name)) {
        const r = parseInt(m[1], 10);
        const c = parseInt(m[2], 10);
        if (!isNaN(r) && !isNaN(c) && r < ROWS && c < COLS) {
          // ensure per-pad material
          child.material = child.material.clone();
          if (child.material.color) child.material.color.set(INACTIVE_COLOR);
          child.userData = child.userData || {};
          child.userData.row = r;
          child.userData.col = c;
          child.userData.active = false;
          grid[r][c] = child;
          pads.push(child);
          processedParents.add(parent.name);
        }
      }
    }

    // screenDisplay special-case
    if (child.name === "screenDisplay") {
      // create canvas & texture for this mesh
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.encoding = THREE.sRGBEncoding;

      const displayMaterial = infoMaterial.clone();
      displayMaterial.map = texture;
      displayMaterial.map.image = canvas;
      displayMaterial.map.needsUpdate = true;

      // set child material and store ctx/texture
      child.material = displayMaterial;
      child.userData = child.userData || {};
      child.userData.ctx = ctx;
      child.userData.texture = texture;
      screenDisplay = child;

      // flip horizontally so text not mirrored
      child.scale.x *= -1;

      console.log("📺 ScreenDisplay gekoppeld en canvastexture toegevoegd.");
      updateInfoDisplay("💬 Ready");
    }
  });

  // push subdivision buttons into array (may be null if not found)
  sub16Button3D = findMeshForParent("sub16Button");
  sub8Button3D = findMeshForParent("sub8Button");
  sub4Button3D = findMeshForParent("sub4Button");
  subdivisionButtons.push(sub16Button3D, sub8Button3D, sub4Button3D);

  subdivisionButtons.forEach(btn => {
    if (!btn) return;
    btn.material = btn.material.clone();
    btn.material.color.set(INACTIVE_COLOR);
  });

  // set active subdivision visual (16 default)
  setActiveSubdivisionButton(sub16Button3D, "16");

  setupWaveformDisplay();

  console.log(`✅ ${pads.length} pads gevonden.`);
  console.table(pads.map(p => ({ naam: p.name, rij: p.userData.row, kolom: p.userData.col })));
  console.log("Start:", !!startButton3D, "Stop:", !!stopButton3D, "Rec:", !!startRecButton3D);
}, undefined, (err) => {
  console.error("❌ Fout bij laden van model:", err);
});

/* ===========================
   GRID STORAGE (2D grid referencing meshes)
   =========================== */
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

/* ===========================
   AUDIO LOADING & PLAYBACK
   =========================== */
async function loadAllAudio() {
  console.log("🎧 Laden van audio gestart...");
  const promises = instrumentFiles.map(async fileUrl => {
    try {
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      const filename = fileUrl.split('/').pop();
      audioBuffers[filename] = decoded;
      console.log(`✅ Loaded: ${filename}`);
    } catch (err) {
      console.error("Audio load error:", fileUrl, err);
    }
  });

  await Promise.all(promises);
  samplesLoaded = true;
  updateInfoDisplay("Samples geladen!");
  console.log("🎵 Alle audio geladen!");
}
document.addEventListener("click", () => {
  if (audioContext.state === "suspended") audioContext.resume();
});
loadAllAudio();

// helper: load samples for a different library (clears old)
async function loadLibrarySamples(files) {
  console.log("🔁 Samples herladen...");
  // clear old buffers
  for (const k in audioBuffers) delete audioBuffers[k];

  await Promise.all(files.map(async fileUrl => {
    try {
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      const filename = fileUrl.split('/').pop();
      audioBuffers[filename] = decoded;
      console.log(`✅ Loaded: ${filename}`);
    } catch (err) {
      console.error("❌ Fout bij laden van:", fileUrl, err);
    }
  }));

  samplesLoaded = true;
  updateInfoDisplay("🎧 Nieuwe samples geladen");
  console.log("✅ Nieuwe library samples geladen!");
}

// playSound: accept AudioBuffer or URL/filename
function playSound(urlOrBuffer, mesh = null) {
  if (audioContext.state === "suspended") audioContext.resume();
  let buffer = null;
  if (urlOrBuffer instanceof AudioBuffer) buffer = urlOrBuffer;
  else if (typeof urlOrBuffer === 'string') {
    const name = urlOrBuffer.split('/').pop();
    buffer = audioBuffers[name];
  }
  if (!buffer) {
    console.warn("⚠️ Geen buffer gevonden voor:", urlOrBuffer);
    return;
  }

  const src = audioContext.createBufferSource();
  src.buffer = buffer;

  const voiceGain = audioContext.createGain();
  voiceGain.gain.value = 1.0;

  src.connect(voiceGain);
  voiceGain.connect(gainNode);

  src.start();

  src.onended = () => {
    try { src.disconnect(); voiceGain.disconnect(); } catch (e) {}
  };

  if (mesh) flashPad(mesh);
}

function playSoundForPad(row, col, padMesh = null) {
  const url = instrumentFiles[row];
  if (!url) return;
  const filename = url.split('/').pop();
  const buffer = audioBuffers[filename];
  if (buffer) playSound(buffer, padMesh);
}

/* ===========================
   INTERACTION (RAYCAST / POINTER)
   =========================== */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getPadFromObject(obj) {
  while (obj) {
    if (pads.includes(obj)) return obj;
    if (obj.userData && obj.userData.row !== undefined && obj.userData.col !== undefined) return obj;
    obj = obj.parent;
  }
  return null;
}

window.addEventListener("click", (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length === 0) return;
  const obj = intersects[0].object;
  


  // Handle UI-like 3D buttons
 /*if (obj.name === startButton3D) { flashButton(obj, 0xffff00); startSequence(); return; }
  if (obj === stopButton3D)  { flashButton(obj, 0xff0000); stopSequence(); return; }
  if (obj === startRecButton3D) { flashButton(obj, 0xff0000); startRecording(); return; }
  if (obj === stopRecButton3D)  { flashButton(obj, 0x00ff00); stopRecording(); return; }*/
/*
  if (obj === saveButton3D) {
    inputMode = "save"; inputBuffer = "";
    updateInfoDisplay("💾 Voer bestandsnaam in:");
    return;
  }
  if (obj === loadButton3D) {
    const keys = Object.keys(localStorage).filter(k => k.startsWith("sequence_")).map(k => k.replace("sequence_", ""));
    if (keys.length === 0) updateInfoDisplay("⚠️ Geen sequences gevonden.");
    else updateInfoDisplay("📂 Beschikbaar:\n" + keys.join("\n"));
    inputMode = "load"; inputBuffer = "";
    return;
  }

  // Library buttons
  if (obj === lib1Button3D) { setLibrary("lib1", lib1Button3D); return; }
  if (obj === lib2Button3D) { setLibrary("lib2", lib2Button3D); return; }
  if (obj === lib3Button3D) { setLibrary("lib3", lib3Button3D); return; }
*/
  // Pad click
  const pad = getPadFromObject(obj);
  if (pad) {
    togglePad(pad);
    console.log("click pad", pad.userData.row, pad.userData.col, pad.userData.active);
    return;
  }
});

// pointerdown handles dragging sliders and more sophisticated interactions if needed
let draggingSlider = null;
let dragPlane = null;
let dragOffset = 0;
window.addEventListener("pointerdown", (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const clickable = [
    startButton3D, stopButton3D,
    startRecButton3D, stopRecButton3D,
    saveButton3D, loadButton3D,
    /*volumeSlider3D, tempoSlider3D,*/ // if in-model sliders exist
    sub16Button3D, sub8Button3D, sub4Button3D,
    lib1Button3D, lib2Button3D, lib3Button3D,
    ...pads
  ].filter(Boolean);

  /*const intersects = raycaster.intersectObjects(clickable, true);
  if (intersects.length === 0) return;
  const obj = intersects[0].object;*/

  // Raycast over de hele drumkit
  if (!drumkit) return;
  const intersects = raycaster.intersectObjects(drumkit.children, true);
  if (intersects.length === 0) return;

  // Neem het eerste object dat geraakt wordt
  let target = intersects[0].object;

  // ✅ Klim omhoog tot we een knop of ouder herkennen
  while (target && target.parent && target.parent.type !== "Scene") {
    if (["StartButton", "StopButton", "lib1Button", "lib2Button", "lib3Button", "startRec", "stopRec", "saveSequence", "loadSequence", "sub16Button", "sub8Button", "sub4Button"].includes(target.name)) break;
    target = target.parent;
  }

  // ✅ Controleer of dit de start-knop is (ouder of kind)
  if (
    target === startButton3D ||
    target.name === "StartButton" ||
    target.parent?.name === "StartButton"
  ) {
    console.log("▶️ Start button clicked");
    flashButton(startButton3D, 0x00ff00); // optische feedback
    startSequence();
    updateInfoDisplay("▶️ Playing");
    return;
  }

  if (
    target === stopButton3D ||
    target.name === "StopButton" ||
    target.parent?.name === "StopButton"
  ) {
    console.log("▶️ Stop button clicked");
    flashButton(stopButton3D, 0xff0000); // optische feedback
    stopSequence();
    updateInfoDisplay("▶️ Stopped");
    return;
  }

  if(
    target === lib1Button3D ||
    target.name === "lib1Button" ||
    target.parent?.name === "lib1Button"
  ) {
    setLibrary("lib1", lib1Button3D);
    return;
  }

  if(
    target === lib2Button3D ||
    target.name === "lib2Button" ||
    target.parent?.name === "lib2Button"
  ) {
    setLibrary("lib2", lib2Button3D);
    return;
  }

  if(
    target === lib3Button3D ||
    target.name === "lib3Button" ||
    target.parent?.name === "lib3Button"
  ) {
    setLibrary("lib3", lib3Button3D);
    return;
  }

  if(
    target === startRecButton3D ||
    target.name === "startRec" ||
    target.parent?.name === "startRec"
  ) {
    console.log("🔴 Start Recording button clicked");
    flashButton(startRecButton3D, 0xff0000); // optische feedback
    startRecording();
    updateInfoDisplay("🔴 Recording started");
    return;
  }

  if(
    target === stopRecButton3D ||
    target.name === "stopRec" ||
    target.parent?.name === "stopRec"
  ) {
    console.log("🟢 Stop Recording button clicked");
    flashButton(stopRecButton3D, 0x00ff00); // optische feedback
    stopRecording();
    updateInfoDisplay("🟢 Recording stopped");
    return;
  }

  if(
    target === saveButton3D ||
    target.name === "saveSequence" ||
    target.parent?.name === "saveSequence"
  ) {
    inputMode = "save"; inputBuffer = "";
    updateInfoDisplay("💾 Voer bestandsnaam in:");
    return;
  }

  if(
    target === loadButton3D ||
    target.name === "loadSequence" ||
    target.parent?.name === "loadSequence"
  ) {
    const keys = Object.keys(localStorage).filter(k => k.startsWith("sequence_")).map(k => k.replace("sequence_", ""));
    if (keys.length === 0) updateInfoDisplay("⚠️ Geen sequences gevonden.");
    else updateInfoDisplay("📂 Beschikbaar:\n" + keys.join("\n"));
    inputMode = "load"; inputBuffer = "";
    return;
  }

  if(
    target === sub16Button3D ||
    target.name === "sub16Button" ||
    target.parent?.name === "sub16Button"
  ) {
    setActiveSubdivisionButton(sub16Button3D, "16");
    return;
  }
  if(
    target === sub8Button3D ||
    target.name === "sub8Button" ||
    target.parent?.name === "sub8Button"
  ) {
    setActiveSubdivisionButton(sub8Button3D, "8");
    return;
  }
  if(
    target === sub4Button3D ||
    target.name === "sub4Button" ||
    target.parent?.name === "sub4Button"
  ) {
    setActiveSubdivisionButton(sub4Button3D, "4");
    return;
  }

  /*function getChildMeshOf(name) {
  const parent = scene.getObjectByName(name);
  if (!parent) return null;
  // zoek het eerste kind dat een mesh is
  const meshChild = parent.children.find(c => c.isMesh);
  return meshChild || null;
}

startButton3D = getChildMeshOf("StartButton");
stopButton3D  = getChildMeshOf("StopButton");

console.log("🟢 StartButton parent:", scene.getObjectByName("StartButton"));
console.log("🔵 StartButton child mesh:", startButton3D);

  // Zoek de bovenliggende knop als er op een kindmesh is geklikt
let target = obj;
while (target.parent && !target.userData?.isButton && target.parent.type !== "Scene") {
  target = target.parent;
}

// start/stop sequence buttons
if (target.name === "StartButton" || target === startButton3D) { flashButton(target, 0xffff00); startSequence(); return; }
if (target === stopButton3D)  { flashButton(target, 0xff0000); stopSequence(); return; }

  // subdivision buttons
  if (target === sub16Button3D) { setActiveSubdivisionButton(sub16Button3D, "16"); return; }
  if (target === sub8Button3D)  { setActiveSubdivisionButton(sub8Button3D, "8"); return; }
  if (target === sub4Button3D)  { setActiveSubdivisionButton(sub4Button3D, "4"); return; }

  // save/load via model buttons
  if (target === saveButton3D) { inputMode = "save"; inputBuffer = ""; updateInfoDisplay("💾 Voer bestandsnaam in:"); return; }
  if (target === loadButton3D) { inputMode = "load"; inputBuffer = ""; showSavedSequencesInDisplay(); return; }

  // start/stop/record handled in click listener above*/
});

/* ===========================
   VISUAL / HELPERS
   =========================== */
function flashButton(mesh, color) {
  if (!mesh || !mesh.material || !mesh.material.color) return;
  const original = mesh.material.color.clone();
  mesh.material = mesh.material.clone();
  mesh.material.color.set(color);
  setTimeout(() => mesh.material.color.copy(original), 200);
}

function flashPad(mesh) {
  if (!mesh || !mesh.material || !mesh.material.color) return;
  mesh.material = mesh.material.clone();
  mesh.material.color.set(0xffff00);
  setTimeout(() => {
    try {
      mesh.material.color.set(mesh.userData.active ? ACTIVE_COLOR : INACTIVE_COLOR);
    } catch (e) {}
  }, Math.max(30, stepDuration / 2));
}

function togglePad(mesh) {
  if (!mesh) return;
  if (!mesh.userData) mesh.userData = { active: false };
  mesh.userData.active = !mesh.userData.active;

  // find visible mesh to recolor
  let target = mesh;
  if (!mesh.material && mesh.children.length) {
    target = mesh.children.find(c => c.material) || mesh;
  }

  if (target.material) {
    target.material = target.material.clone();
    target.material.color.set(mesh.userData.active ? ACTIVE_COLOR : INACTIVE_COLOR);
  } else {
    console.warn("Geen materiaal gevonden voor pad:", mesh.name);
  }

  if (mesh.userData.active) playSoundForPad(mesh.userData.row, mesh.userData.col, mesh);
  console.log(`Pad ${mesh.userData.row},${mesh.userData.col} actief:`, mesh.userData.active);
}

function spawnParticles(position, color = 0xffff00) {
  for (let i = 0; i < 8; i++) {
    const geometry = new THREE.SphereGeometry(0.02, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color });
    const particle = new THREE.Mesh(geometry, material);
    particle.position.copy(position);
    particle.velocity = new THREE.Vector3((Math.random()-0.5)*0.1, Math.random()*0.15+0.05, (Math.random()-0.5)*0.1);
    particle.life = 1.0;
    scene.add(particle);
    particles.push(particle);
  }
}

/* ===========================
   SUBDIVISION / SEQUENCER
   =========================== */
function updateStepDuration() {
  // milliseconds per step
  stepDuration = (60000 / tempo) * (4 / subdivision);
}

function setActiveSubdivisionButton(activeButton, value) {
  subdivisionButtons.forEach(btn => {
    if (!btn) return;
    btn.material = btn.material.clone();
    btn.material.color.set(INACTIVE_COLOR);
  });

  if (activeButton) {
    activeButton.material = activeButton.material.clone();
    activeButton.material.color.set(ACTIVE_COLOR);
  }

  switch (value) {
    case "4": subdivision = 4; break;
    case "8": subdivision = 8; break;
    default: subdivision = 16;
  }

  updateStepDuration();
  updateInfoDisplay(`🎚️ Subdivisie ingesteld op ${value}`);

  if (isPlaying) {
    // restart scheduler by toggling play state (we use requestAnimationFrame scheduler)
    stopSequence();
    startSequence();
  }
}

function playStep(col) {
  if (!grid) return;

  // reset colors (active/inactive)
  pads.forEach(p => {
    if (p.material) p.material.color.set(p.userData.active ? ACTIVE_COLOR : INACTIVE_COLOR);
  });

  for (let row = 0; row < ROWS; row++) {
    const pad = grid[row][col];
    if (!pad) continue;

    // mark current step
    if (pad.material) pad.material.color.set(0xffffff);

    if (pad.userData.active) {
      const file = instrumentFiles[row];
      if (file) playSoundForPad(row, col, pad);
    }

    setTimeout(() => {
      if (pad.material) pad.material.color.set(pad.userData.active ? ACTIVE_COLOR : INACTIVE_COLOR);
    }, stepDuration / 1.5);
  }
}

function startSequence() {
  stopSequence(); // clear previous
  currentStep = 0;
  updateStepDuration();
  isPlaying = true;

  let nextStepTime = audioContext.currentTime;

  function scheduler() {
    const now = audioContext.currentTime;
    while (nextStepTime < now + 0.1) { // schedule small lookahead (we're not sample-scheduling, just visual)
      playStep(currentStep);
      currentStep = (currentStep + 1) % COLS;
      nextStepTime += (stepDuration / 1000);
    }
    if (isPlaying) requestAnimationFrame(scheduler);
  }

  scheduler();
  updateInfoDisplay("▶️ Playing");
  console.log("▶️ Sequence gestart");
}

function stopSequence() {
  isPlaying = false;
  updateInfoDisplay("■ Stopped");
  console.log("■ Sequence gestopt");
}

/* ===========================
   RECORDING / MICROPHONE
   =========================== */
function startRecording() {
  audioChunks = [];
  mediaRecorder.start();
  updateInfoDisplay("🔴 Recording...");
  console.log("🔴 Recording gestart");
}
function stopRecording() {
  mediaRecorder.stop();
  updateInfoDisplay("✅ Saved recording");
  console.log("Recording gestopt en opgeslagen");
}

let micStream = null, micSource = null, micActive = false;
async function toggleMicrophone() {
  if (!micActive) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }});
      micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(gainNode);
      micActive = true;
      updateInfoDisplay("🎤 Microfoon aan");
      console.log("🎤 Microfoon verbonden");
    } catch (err) {
      console.error("Microfoonfout:", err);
      updateInfoDisplay("⚠️ Geen microfoon toegang");
    }
  } else {
    if (micSource) micSource.disconnect();
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    micActive = false;
    updateInfoDisplay("🎤 Microfoon uit");
    console.log("🎤 Microfoon uit");
  }
}

/* ===========================
   SAVE / LOAD (localStorage)
   =========================== */
function getGridState() {
  return grid.map(row => row.map(cell => !!cell?.userData?.active));
}
function setGridState(state) {
  state.forEach((row, r) => row.forEach((active, c) => {
    if (grid[r][c]) {
      grid[r][c].userData.active = !!active;
      grid[r][c].material = grid[r][c].material.clone();
      grid[r][c].material.color.set(grid[r][c].userData.active ? ACTIVE_COLOR : INACTIVE_COLOR);
    }
  }));
}

function saveSequenceByName(name) {
  if (!name) return false;
  try {
    const data = {
      gridState: getGridState(),
      tempo,
      subdivision,
      instrumentFiles
    };
    localStorage.setItem(`sequence_${name}`, JSON.stringify(data));
    console.log(`✅ Sequence '${name}' opgeslagen.`);
    return true;
  } catch (err) {
    console.error("❌ Fout bij opslaan:", err);
    return false;
  }
}

function loadSequenceByName(name) {
  if (!name) return false;
  try {
    const dataStr = localStorage.getItem(`sequence_${name}`);
    if (!dataStr) return false;
    const data = JSON.parse(dataStr);
    if (data.gridState) setGridState(data.gridState);
    if (data.tempo) tempo = data.tempo;
    if (data.subdivision) subdivision = data.subdivision;
    updateStepDuration();
    console.log(`🎵 Sequence '${name}' geladen.`);
    return true;
  } catch (err) {
    console.error("❌ Fout bij laden:", err);
    return false;
  }
}

// backward-compatible aliases (your code referenced these names)
function saveBeat(name) { return saveSequenceByName(name); }
function loadBeat(name) { return loadSequenceByName(name); }

// UI helpers for showing stored sequences
function showSavedSequencesInDisplay() {
  const sequences = Object.keys(localStorage)
    .filter(k => k.startsWith("sequence_"))
    .map(k => k.replace("sequence_", ""));
  if (sequences.length === 0) updateInfoDisplay("📂 Geen opgeslagen sequences gevonden.");
  else updateInfoDisplay(`📂 Beschikbare sequences:\n${sequences.join("\n")}`);
}

/* ===========================
   LIBRARY SWITCHING
   =========================== */
function setLibrary(libName, button3D) {
  console.log(`🎚️ Wisselen naar ${libName}`);
  instrumentFiles = libraries[libName].slice();

  // visual update of lib buttons
 /* [lib1Button3D, lib2Button3D, lib3Button3D].forEach(btn => {
    if (!btn) return;
    btn.material = btn.material.clone();
    btn.material.color.set(btn === button3D ? ACTIVE_COLOR : INACTIVE_COLOR);
  });*/

  loadLibrarySamples(instrumentFiles);
  updateInfoDisplay(`🎵 ${libName} geladen`);
}

/* ===========================
   INPUT MODE (keyboard for save/load)
   =========================== */
function enterInputMode(mode, initial = "") {
  inputMode = mode;
  inputBuffer = initial || "";
  updateInfoDisplay((mode === 'save' ? "💾 Naam invoeren: " : "📂 Kies naam: ") + (inputBuffer ? inputBuffer + "_" : "_"));
}

// single keydown handler for inputMode
window.addEventListener("keydown", (e) => {
  // always allow resume audio on any click/interaction; handled elsewhere
  if (!inputMode) return;

  e.preventDefault();
  if (e.repeat) return;

  if (e.key === "Enter") {
    const name = inputBuffer.trim();
    if (!name) {
      updateInfoDisplay("⚠️ Geen naam ingevoerd.");
    } else {
      if (inputMode === "save") {
        const ok = saveSequenceByName(name);
        updateInfoDisplay(ok ? `✅ '${name}' opgeslagen!` : `❌ Opslaan mislukt.`);
      } else if (inputMode === "load") {
        const ok = loadSequenceByName(name);
        updateInfoDisplay(ok ? `🎵 '${name}' geladen!` : `❌ '${name}' niet gevonden.`);
      }
    }
    inputMode = null;
    inputBuffer = "";
    return;
  }

  if (e.key === "Escape") {
    updateInfoDisplay("✖️ Input geannuleerd");
    inputMode = null;
    inputBuffer = "";
    return;
  }

  if (e.key === "Backspace") {
    inputBuffer = inputBuffer.slice(0, -1);
    updateInfoDisplay((inputMode === 'save' ? "💾 " : "📂 ") + (inputBuffer ? inputBuffer + "_" : "_"));
    return;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    inputBuffer += e.key;
    updateInfoDisplay((inputMode === 'save' ? "💾 " : "📂 ") + inputBuffer + "_");
    return;
  }
});

/* ===========================
   UI PANEL (DOM)
   =========================== */
const ui = document.createElement('div');
ui.style.position = 'fixed';
ui.style.left = '12px';
ui.style.bottom = '12px';
ui.style.padding = '10px';
ui.style.background = 'rgba(0,0,0,0.6)';
ui.style.color = 'white';
ui.style.zIndex = '9999';
ui.style.borderRadius = '6px';
ui.style.fontFamily = 'sans-serif';

ui.innerHTML = `
  <div><strong>3D Drum Machine</strong></div>
  <label>Tempo: <span id="tempoVal">${tempo}</span> BPM</label><br>
  <input id="tempoSlider" type="range" min="60" max="200" value="${tempo}" style="width:200px"><br>
  <label>Volume: <span id="volVal">${gainNode.gain.value.toFixed(2)}</span></label><br>
  <input id="volSlider" type="range" min="0" max="1" step="0.01" value="${gainNode.gain.value}" style="width:200px"><br>
  <button id="uiStart">Start</button>
  <button id="uiStop">Stop</button><br>
  <button id="uiSave" style="margin-top:6px;">Save</button>
  <button id="uiLoad" style="margin-left:6px;">Load</button><br>
  <button id="uiRecord" style="background:red;margin-top:6px;">Start Recording</button>
  <button id="uiStopRec" style="margin-left:6px;">Stop Recording</button>
  <input type="range" id="volume" min="0" max="1" step="0.01" value="${gainNode.gain.value}"><br>
  <button id="uiMic" style="margin-top:6px;">🎤 Zet microfoon aan</button>
`;
document.body.appendChild(ui);

document.getElementById('tempoSlider').addEventListener('input', (e) => {
  tempo = parseInt(e.target.value);
  const tempoVal = document.getElementById('tempoVal');
  if (tempoVal) tempoVal.textContent = tempo;
  updateStepDuration();
  if (isPlaying) { stopSequence(); startSequence(); }
});
document.getElementById('volSlider').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  gainNode.gain.value = v;
  const volVal = document.getElementById('volVal');
  if (volVal) volVal.textContent = v.toFixed(2);
});
document.getElementById('uiStart').addEventListener('click', () => { startSequence(); updateInfoDisplay("▶ Playing"); });
document.getElementById('uiStop').addEventListener('click', () => { stopSequence(); updateInfoDisplay("■ Stopped"); });

document.getElementById('uiRecord').addEventListener('click', () => { startRecording(); });
document.getElementById('uiStopRec').addEventListener('click', () => { stopRecording(); });
document.getElementById('uiMic').addEventListener('click', toggleMicrophone);

document.getElementById('uiSave').addEventListener('click', () => {
  const name = prompt("Geef een naam voor je beat:");
  if (name) saveSequenceByName(name);
});
document.getElementById('uiLoad').addEventListener('click', () => {
  const beats = Object.keys(localStorage).filter(k => k.startsWith("sequence_")).map(k => k.replace("sequence_", ""));
  if (beats.length === 0) return updateInfoDisplay("⚠ Geen opgeslagen beats");
  const names = beats.join(", ");
  const choice = prompt(`Kies een beat om te laden:\n${names}`);
  if (choice) {
    loadSequenceByName(choice);
    updateInfoDisplay(`📂 Beat "${choice}" geladen`);
  }
});

document.getElementById("volume").addEventListener("input", (e) => {
  const vol = parseFloat(e.target.value);
  gainNode.gain.value = vol;
  console.log("🔉 Volume:", vol);
});

/* ===========================
   ANIMATION / RENDER LOOP
   =========================== */
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // waveform
  updateWaveformDisplay();

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.position.add(p.velocity);
    p.velocity.multiplyScalar(0.95);
    p.life -= 0.02;
    p.material.opacity = p.life;
    if (p.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}
animate();

/* ===========================
   INIT / UTILITIES / RESIZE
   =========================== */
window.addEventListener("resize", () => {
  const newDpr = window.devicePixelRatio || 1;
  infoCanvas.width = 512 * newDpr;
  infoCanvas.height = 128 * newDpr;
  infoCtx.setTransform(1, 0, 0, 1, 0, 0);
  infoCtx.scale(newDpr, newDpr);

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  infoTexture.needsUpdate = true;
  updateInfoDisplay("Display updated");
});

// helper utils
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(x, min, max) { return Math.min(Math.max(x, min), max); }

/* ===========================
   INITIAL STATE
   =========================== */
updateStepDuration();
updateInfoDisplay("🔧 DrumMachine geladen – klik om te starten");