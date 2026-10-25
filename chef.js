
import {
  db,
  collection,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "./firebase.js";

const $ = id => document.getElementById(id);

// Demo password only. Do not use this as production security.
const CHEF_PASSWORD = "Chef@123";

let unsubscribeOrders = null;
let knownOrderIds = new Set();
let firstSnapshot = true;
let audioContext = null;
let busyOrders = new Set();

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").style.display = "none", 2800);
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    audioContext ||= new AudioCtx();
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();

    gain.gain.exponentialRampToValueAtTime(
      0.001, audioContext.currentTime + 0.35
    );
    oscillator.stop(audioContext.currentTime + 0.36);
  } catch (error) {
    console.warn("Beep unavailable", error);
  }
}

function formatTime(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "Time unavailable";
  }
  return timestamp.toDate().toLocaleString("en-IN");
}

function orderStatus(status) {
  const allowed = ["Received", "Preparing", "Ready", "Completed"];
  return allowed.includes(status) ? status : "Received";
}

function renderOrder(id, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const phone = String(data.customerPhone || "").replace(/\D/g, "");
  const safePhone = phone.slice(-10);
  const status = orderStatus(data.status);

  const itemHTML = items.map(item => {
    const name = safeText(item.name || "Food item");
    const qty = Math.max(1, Number(item.qty) || 1);
    const price = Math.max(0, Number(item.price) || 0);

    return `
      <div class="item-row">
        <span>${name} × ${qty}</span>
        <span>₹${(price * qty).toFixed(0)}</span>
      </div>
    `;
  }).join("");

  const calculatedTotal = items.reduce((sum, item) => {
    return sum +
      Math.max(0, Number(item.price) || 0) *
      Math.max(1, Number(item.qty) || 1);
  }, 0);

  const total = Number.isFinite(Number(data.total))
    ? Number(data.total)
    : calculatedTotal;

  const card = document.createElement("article");
  card.className = "order-card";
  card.dataset.id = id;

  card.innerHTML = `
    <div class="order-top">
      <div>
        <h2>📞 ${safePhone ? "+91 " + safeText(safePhone) : "Number unavailable"}</h2>
        <div class="order-id">Order ID: ${safeText(id.slice(-8))}</div>
        <div class="order-id">${safeText(formatTime(data.createdAt))}</div>
      </div>
      <span class="status">${safeText(status)}</span>
    </div>
    <div class="order-body">
      <div class="section-label">ORDERED ITEMS</div>
      ${itemHTML || "<p>No item details found.</p>"}
      <div class="order-total">
        <span>Total</span>
        <span>₹${total.toFixed(0)}</span>
      </div>
      <div class="order-actions">
        <a class="call-btn"
          href="${safePhone.length === 10 ? "tel:+91" + safePhone : "#"}"
          ${safePhone.length === 10 ? "" : 'aria-disabled="true"'}>
          📞 Call Customer
        </a>
        <button class="delete-btn" data-action="delete">
          🗑 Delete Order
        </button>
      </div>
      <div class="status-actions">
        <button data-action="Preparing">Preparing</button>
        <button data-action="Ready">Ready</button>
      </div>
    </div>
  `;

  card.querySelectorAll("button[data-action]").forEach(button => {
    const action = button.dataset.action;
    button.addEventListener("click", async () => {
      if (busyOrders.has(id)) return;

      if (action === "delete") {
        const confirmed = window.confirm(
          "Delete this order? This cannot be undone."
        );
        if (!confirmed) return;

        busyOrders.add(id);
        button.disabled = true;

        try {
          await deleteDoc(doc(db, "orders", id));
          toast("Order deleted.");
        } catch (error) {
          console.error(error);
          toast("Delete failed. Check Firebase permissions.");
          button.disabled = false;
        } finally {
          busyOrders.delete(id);
        }
        return;
      }

      busyOrders.add(id);
      button.disabled = true;
      try {
        await updateDoc(doc(db, "orders", id), {
          status: action,
          updatedAt: serverTimestamp()
        });
        toast("Order marked " + action + ".");
      } catch (error) {
        console.error(error);
        toast("Status update failed. Check Firebase permissions.");
      } finally {
        busyOrders.delete(id);
        button.disabled = false;
      }
    });
  });

  return card;
}

function startOrders() {
  if (unsubscribeOrders) unsubscribeOrders();

  $("connectionMessage").textContent = "Connecting to Firebase...";
  $("ordersList").replaceChildren();
  $("emptyMessage").classList.add("hidden");
  $("activeCount").textContent = "0";
  knownOrderIds = new Set();
  firstSnapshot = true;

  const ordersQuery = query(
    collection(db, "orders"),
    orderBy("createdAt", "desc")
  );

  unsubscribeOrders = onSnapshot(ordersQuery, snapshot => {
    const nextIds = new Set();

    snapshot.forEach(orderDoc => {
      const data = orderDoc.data();
      const status = orderStatus(data.status);

      // Hide completed orders from the active dashboard.
      if (status === "Completed") return;

      nextIds.add(orderDoc.id);

      if (!firstSnapshot && !knownOrderIds.has(orderDoc.id)) {
        playBeep();
        toast("🔔 New order received!");
      }
    });

    knownOrderIds = nextIds;
    firstSnapshot = false;

    const fragment = document.createDocumentFragment();

    snapshot.docs.forEach(orderDoc => {
      const data = orderDoc.data();
      if (orderStatus(data.status) === "Completed") return;
      fragment.appendChild(renderOrder(orderDoc.id, data));
    });

    $("ordersList").replaceChildren(fragment);
    $("activeCount").textContent = nextIds.size;
    $("emptyMessage").classList.toggle("hidden", nextIds.size !== 0);
    $("connectionMessage").textContent = "🟢 Connected — live order updates enabled.";
  }, error => {
    console.error(error);
    $("connectionMessage").textContent =
      "Could not load orders. Check internet and Firebase Firestore rules.";
    toast("Firebase connection failed.");
  });
}

$("loginForm").addEventListener("submit", event => {
  event.preventDefault();

  if ($("chefPassword").value !== CHEF_PASSWORD) {
    $("loginError").textContent = "Incorrect password.";
    return;
  }

  $("loginError").textContent = "";
  $("loginScreen").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");

  // Audio is more likely to work after the user's login tap.
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioContext = new AudioCtx();
      audioContext.resume().catch(() => {});
    }
  } catch (_) {}

  startOrders();
});

$("logoutBtn").addEventListener("click", () => {
  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }

  $("dashboard").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("logoutBtn").classList.add("hidden");
  $("chefPassword").value = "";
  $("ordersList").replaceChildren();
});
