// Import Firebase SDKs directly from CDN for GitHub Pages
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getDatabase, ref, set, update, onValue, onChildAdded, onChildRemoved, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBQQt8FZ1J2xf0vqZaGDpPYrjh53Vi1-ZQ",
  authDomain: "kitacat-spacecats.firebaseapp.com",
  projectId: "kitacat-spacecats",
  storageBucket: "kitacat-spacecats.firebasestorage.app",
  messagingSenderId: "26759798313",
  appId: "1:26759798313:web:31e13bd39fa752f8454638",
  measurementId: "G-2B7S8Z3TV7",
  databaseURL: "https://kitacat-spacecats-default-rtdb.europe-west1.firebasedatabase.app/"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// Web Audio API Synth Sounds
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === 'laser') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } else if (type === 'coin') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } else if (type === 'hit') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  }
}

// App State
let currentUser = null;
let unsubscribeFirestore = null;
let gameLoopId = null;

let userData = {
  name: "SpaceCat",
  coins: 0,
  kills: 0,
  deaths: 0,
  skin: "default",
  unlockedSkins: ["default"],
  laserLevel: 1,
  speedLevel: 1
};

// Player Local Engine State
const playerState = {
  id: null,
  x: Math.random() * 1200 + 100,
  y: Math.random() * 1200 + 100,
  angle: 0,
  health: 100,
  maxHealth: 100,
  speed: 5
};

const otherPlayers = {};
const projectiles = {}; // Stores all active lasers
const spaceCoins = {};

// Canvas Setup
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Controls
const keys = {};
const mouse = { x: 0, y: 0 };

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.code === "Space") {
    fireLaser();
  }
});

window.addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// UI Elements
const loginScreen = document.getElementById("loginScreen");
const hud = document.getElementById("hud");
const usernameInput = document.getElementById("usernameInput");
const startGameBtn = document.getElementById("startGameBtn");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const userInfoBox = document.getElementById("userInfo");
const userDisplayName = document.getElementById("userDisplayName");
const logoutBtn = document.getElementById("logoutBtn");

const shopModal = document.getElementById("shopModal");
const shopBtn = document.getElementById("shopBtn");
const closeShopBtn = document.getElementById("closeShopBtn");

// Google Auth Handlers
const googleProvider = new GoogleAuthProvider();

googleLoginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("Google Sign In Error:", err);
    alert("Google login failed: " + err.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  if (playerState.id) {
    await remove(ref(rtdb, `players/${playerState.id}`));
  }
  await signOut(auth);
});

// Auth Persistence Listener (Auto-login)
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    playerState.id = user.uid;

    userDisplayName.innerText = user.displayName || user.email;
    userInfoBox.classList.remove("hidden");
    googleLoginBtn.classList.add("hidden");
    startGameBtn.classList.remove("hidden");

    // Load Firestore User Data
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      userData = { ...userData, ...snap.data() };
    } else {
      userData.name = user.displayName || "SpaceCat";
      await setDoc(userRef, userData);
    }

    usernameInput.value = userData.name;

    // Realtime Firestore Listener
    if (unsubscribeFirestore) unsubscribeFirestore();
    unsubscribeFirestore = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        userData = { ...userData, ...docSnap.data() };
        updateHUD();
        updateShopUI();
      }
    });

  } else {
    currentUser = null;
    playerState.id = null;

    userInfoBox.classList.add("hidden");
    googleLoginBtn.classList.remove("hidden");
    startGameBtn.classList.add("hidden");
    loginScreen.classList.remove("hidden");
    hud.classList.add("hidden");

    if (unsubscribeFirestore) unsubscribeFirestore();
  }
});

// Start Game
startGameBtn.addEventListener("click", () => {
  const nameVal = usernameInput.value.trim();
  if (nameVal) userData.name = nameVal;

  if (currentUser) {
    setDoc(doc(db, "users", currentUser.uid), { name: userData.name }, { merge: true });
  }

  loginScreen.classList.add("hidden");
  hud.classList.remove("hidden");

  initMultiplayer();
});

// Multiplayer Subscriptions
function initMultiplayer() {
  const playerRef = ref(rtdb, `players/${playerState.id}`);

  // Disconnect Cleanup
  onDisconnect(playerRef).remove();

  // Listen to Other Players
  onValue(ref(rtdb, "players"), (snapshot) => {
    const data = snapshot.val() || {};
    Object.keys(data).forEach((id) => {
      if (id !== playerState.id) {
        otherPlayers[id] = data[id];
      }
    });
    Object.keys(otherPlayers).forEach((id) => {
      if (!data[id]) delete otherPlayers[id];
    });
  });

  // Listen for ALL Shots in Room (Both Local and Remote)
  onChildAdded(ref(rtdb, "projectiles"), (snapshot) => {
    const proj = snapshot.val();
    if (proj) {
      projectiles[snapshot.key] = proj;
      if (proj.ownerId !== playerState.id) {
        playSound("laser");
      }
    }
  });

  onChildRemoved(ref(rtdb, "projectiles"), (snapshot) => {
    delete projectiles[snapshot.key];
  });

  // Coins Sync
  onValue(ref(rtdb, "coins"), (snapshot) => {
    const data = snapshot.val() || {};
    Object.assign(spaceCoins, data);
    Object.keys(spaceCoins).forEach((id) => {
      if (!data[id]) delete spaceCoins[id];
    });
  });

  spawnCoinsIfNeeded();

  window.removeEventListener("mousedown", handleMouseDown);
  window.addEventListener("mousedown", handleMouseDown);

  if (gameLoopId) cancelAnimationFrame(gameLoopId);
  gameLoopId = requestAnimationFrame(gameLoop);
}

function handleMouseDown(e) {
  // Prevent shooting when clicking UI buttons or inside active modals
  if (e.target && e.target.tagName === "BUTTON") return;
  if (!loginScreen.classList.contains("hidden") || !shopModal.classList.contains("hidden")) return;
  fireLaser();
}

function spawnCoinsIfNeeded() {
  onValue(ref(rtdb, "coins"), (snapshot) => {
    if (!snapshot.exists() || Object.keys(snapshot.val()).length < 15) {
      for (let i = 0; i < 15; i++) {
        const coinId = "coin_" + Math.random().toString(36).substr(2, 9);
        set(ref(rtdb, `coins/${coinId}`), {
          x: Math.random() * 2000 - 500,
          y: Math.random() * 2000 - 500
        });
      }
    }
  }, { onlyOnce: true });
}

// Fire Laser Action
function fireLaser() {
  if (!currentUser || !playerState.id) return;

  const projId = playerState.id + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const speed = 15;

  const projData = {
    id: projId,
    ownerId: playerState.id,
    x: playerState.x + Math.cos(playerState.angle) * 25,
    y: playerState.y + Math.sin(playerState.angle) * 25,
    vx: Math.cos(playerState.angle) * speed,
    vy: Math.sin(playerState.angle) * speed,
    damage: 10 + (userData.laserLevel - 1) * 5
  };

  set(ref(rtdb, `projectiles/${projId}`), projData);
  playSound("laser");

  // Remove laser after 2.5 seconds
  setTimeout(() => {
    remove(ref(rtdb, `projectiles/${projId}`));
  }, 2500);
}

// Main Engine Game Loop
let lastTime = performance.now();
function gameLoop(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (currentUser && loginScreen.classList.contains("hidden")) {
    updateLocalPlayer();
    updateProjectiles();
    checkCoinCollisions();
    render();
  }
  
  gameLoopId = requestAnimationFrame(gameLoop);
}

function updateLocalPlayer() {
  const speed = playerState.speed + (userData.speedLevel - 1) * 1.5;

  if (keys["w"] || keys["arrowup"]) playerState.y -= speed;
  if (keys["s"] || keys["arrowdown"]) playerState.y += speed;
  if (keys["a"] || keys["arrowleft"]) playerState.x -= speed;
  if (keys["d"] || keys["arrowright"]) playerState.x += speed;

  const screenCenterX = canvas.width / 2;
  const screenCenterY = canvas.height / 2;
  playerState.angle = Math.atan2(mouse.y - screenCenterY, mouse.x - screenCenterX);

  if (playerState.id) {
    update(ref(rtdb, `players/${playerState.id}`), {
      x: playerState.x,
      y: playerState.y,
      angle: playerState.angle,
      name: userData.name,
      skin: userData.skin,
      health: playerState.health
    });
  }
}

function updateProjectiles() {
  Object.keys(projectiles).forEach((id) => {
    const p = projectiles[id];
    p.x += p.vx;
    p.y += p.vy;

    // Hit Detection for enemy lasers against Local Player
    if (p.ownerId !== playerState.id) {
      const dist = Math.hypot(p.x - playerState.x, p.y - playerState.y);
      if (dist < 22) {
        playerState.health -= p.damage;
        playSound("hit");
        
        remove(ref(rtdb, `projectiles/${id}`));
        delete projectiles[id];

        if (playerState.health <= 0) {
          userData.deaths++;
          updateDoc(doc(db, "users", currentUser.uid), { deaths: increment(1) });
          
          playerState.health = 100;
          playerState.x = Math.random() * 1000;
          playerState.y = Math.random() * 1000;
        }
      }
    }
  });
}

function checkCoinCollisions() {
  Object.keys(spaceCoins).forEach((coinId) => {
    const coin = spaceCoins[coinId];
    const dist = Math.hypot(coin.x - playerState.x, coin.y - playerState.y);
    if (dist < 30) {
      playSound("coin");
      remove(ref(rtdb, `coins/${coinId}`));
      delete spaceCoins[coinId];

      userData.coins += 5;
      updateDoc(doc(db, "users", currentUser.uid), { coins: increment(5) });
    }
  });
}

// Canvas Render
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2 - playerState.x, canvas.height / 2 - playerState.y);

  drawGrid();

  // Draw Coins
  Object.values(spaceCoins).forEach((coin) => {
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#ffeb3b";
    ctx.shadowColor = "#ffeb3b";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Draw All Projectiles (Your Lasers = Neon Cyan, Enemy Lasers = Pink)
  Object.values(projectiles).forEach((p) => {
    const isMine = p.ownerId === playerState.id;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = isMine ? "#00ffcc" : "#ff007f";
    ctx.shadowColor = isMine ? "#00ffcc" : "#ff007f";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Draw Other Players
  Object.values(otherPlayers).forEach((p) => {
    drawSpaceCat(p.x, p.y, p.angle, p.skin || "default", p.name, p.health);
  });

  // Draw Local Player
  drawSpaceCat(playerState.x, playerState.y, playerState.angle, userData.skin, userData.name, playerState.health);

  ctx.restore();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  const gridSize = 80;

  const startX = Math.floor((playerState.x - canvas.width) / gridSize) * gridSize;
  const endX = startX + canvas.width * 2;
  const startY = Math.floor((playerState.y - canvas.height) / gridSize) * gridSize;
  const endY = startY + canvas.height * 2;

  for (let x = startX; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }
}

function drawSpaceCat(x, y, angle, skin, name, health) {
  ctx.save();
  ctx.translate(x, y);

  // Player Name & Health Bar
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(name || "Cat", 0, -35);

  ctx.fillStyle = "#333";
  ctx.fillRect(-20, -30, 40, 5);
  ctx.fillStyle = "#00ffcc";
  ctx.fillRect(-20, -30, (Math.max(0, health) / 100) * 40, 5);

  ctx.rotate(angle);

  const colors = {
    default: "#00ffcc",
    cyber: "#ff007f",
    void: "#7928ca",
    nyan: "#ffeb3b"
  };
  const skinColor = colors[skin] || colors.default;

  // Spaceship Body
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-15, -15);
  ctx.lineTo(-10, 0);
  ctx.lineTo(-15, 15);
  ctx.closePath();
  ctx.fillStyle = skinColor;
  ctx.shadowColor = skinColor;
  ctx.shadowBlur = 10;
  ctx.fill();

  // Cat Ears
  ctx.beginPath();
  ctx.moveTo(5, -10);
  ctx.lineTo(12, -18);
  ctx.lineTo(-2, -12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(5, 10);
  ctx.lineTo(12, 18);
  ctx.lineTo(-2, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.restore();
}

// UI Handlers & HUD Updates
function updateHUD() {
  document.getElementById("hudName").innerText = userData.name;
  document.getElementById("hudCoins").innerText = `${userData.coins} 🪙`;
  document.getElementById("hudKD").innerText = `${userData.kills} / ${userData.deaths}`;
  document.getElementById("healthBar").style.width = `${Math.max(0, playerState.health)}%`;
}

function updateShopUI() {
  document.querySelectorAll(".buy-skin-btn").forEach((btn) => {
    const skinKey = btn.getAttribute("data-skin");
    const cost = parseInt(btn.getAttribute("data-cost"));

    if (userData.unlockedSkins.includes(skinKey)) {
      btn.innerText = "Equip";
      btn.className = "btn select-skin-btn";
    } else if (userData.coins < cost) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    }
  });

  document.getElementById("buyLaserUpgrade").innerText = `Upgrade (+5 Dmg) - ${userData.laserLevel * 40} 🪙`;
  document.getElementById("buySpeedUpgrade").innerText = `Upgrade (+1.5 Speed) - ${userData.speedLevel * 40} 🪙`;
}

// Shop Actions
shopBtn.addEventListener("click", () => shopModal.classList.remove("hidden"));
closeShopBtn.addEventListener("click", () => shopModal.classList.add("hidden"));

document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("buy-skin-btn")) {
    const skin = e.target.getAttribute("data-skin");
    const cost = parseInt(e.target.getAttribute("data-cost"));

    if (userData.coins >= cost && !userData.unlockedSkins.includes(skin)) {
      userData.coins -= cost;
      userData.unlockedSkins.push(skin);
      userData.skin = skin;

      await updateDoc(doc(db, "users", currentUser.uid), {
        coins: userData.coins,
        unlockedSkins: userData.unlockedSkins,
        skin: skin
      });
    }
  } else if (e.target.classList.contains("select-skin-btn")) {
    const skin = e.target.getAttribute("data-skin");
    userData.skin = skin;
    await updateDoc(doc(db, "users", currentUser.uid), { skin: skin });
  }
});

// Upgrade Actions
document.getElementById("buyLaserUpgrade").addEventListener("click", async () => {
  const cost = userData.laserLevel * 40;
  if (userData.coins >= cost) {
    userData.coins -= cost;
    userData.laserLevel++;
    await updateDoc(doc(db, "users", currentUser.uid), {
      coins: userData.coins,
      laserLevel: userData.laserLevel
    });
  }
});

document.getElementById("buySpeedUpgrade").addEventListener("click", async () => {
  const cost = userData.speedLevel * 40;
  if (userData.coins >= cost) {
    userData.coins -= cost;
    userData.speedLevel++;
    await updateDoc(doc(db, "users", currentUser.uid), {
      coins: userData.coins,
      speedLevel: userData.speedLevel
    });
  }
});
