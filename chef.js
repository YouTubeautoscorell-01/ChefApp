
import {
  db,
  collection,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "./firebase.js";

const ordersList = document.getElementById("ordersList");
const activeCount = document.getElementById("activeCount");
const preparingCount = document.getElementById("preparingCount");
const readyCount = document.getElementById("readyCount");
const connectionStatus = document.getElementById("connectionStatus");
const notice = document.getElementById("notice");
const refreshBtn = document.getElementById("refreshBtn");

let allOrders = [];
let initialSnapshotReceived = false;
let knownOrderIds = new Set();
let audioContext = null;
let noticeTimeout = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.className = "notice show" + (isError ? " error-notice" : "");

  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => {
    notice.className = "notice";
  }, 4500);
}

function playBeep() {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    if (audioContext.state !== "running") return;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();

    gain.gain.setValueAtTime(0.15, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.35
    );

    oscillator.stop(audioContext.currentTime + 0.35);
  } catch (error) {
    console.warn("Order sound could not play.", error);
  }
}

// Mobile browsers may require a user gesture before audio can play.
document.addEventListener("pointerdown", () => {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!audioContext && AudioContextClass) {
      audioContext = new AudioContextClass();
    }

    if (audioContext?.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  } catch (error) {
    console.warn("Audio is unavailable.", error);
  }
}, { once: true });

function getTimeValue(order) {
  const value = order.createdAt;

  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value instanceof Date) return value.getTime();

  if (typeof value === "number") return value;

  return 0;
}

function formatTime(order) {
  const timestamp = getTimeValue(order);

  if (!timestamp) return "Time unavailable";

  return new Date(timestamp).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatPrice(amount) {
  const value = Number(amount);
  return "₹" + (Number.isFinite(value) ? value.toFixed(2) : "0.00");
}

function getStatus(order) {
  const status = String(order.status || "Received");

  if (["Received", "Preparing", "Ready"].includes(status)) {
    return status;
  }

  return "Received";
}

function getStatusClass(status) {
  return {
    Received: "status-received",
    Preparing: "status-preparing",
    Ready: "status-ready"
  }[status] || "status-received";
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-10);
}

function renderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="empty-state">No items found for this order.</p>';
  }

  return items.map(item => {
    const name = escapeHTML(item.name || "Food item");
    const qty = Math.max(0, Number(item.qty) || 0);
    const price = Number(item.price) || 0;

    return `
      <div class="item-row">
        <span class="item-name">${name}
          <span class="item-qty">× ${qty}</span>
        </span>
        <span class="item-price">${formatPrice(price * qty)}</span>
      </div>
    `;
  }).join("");
}

function renderOrder(id, order) {
  const status = getStatus(order);
  const phone = normalizePhone(order.customerPhone);
  const orderLabel = escapeHTML(id.slice(-7).toUpperCase());
  const total = Number(order.total) || 0;
  const paymentStatus = escapeHTML(order.paymentStatus || "Unpaid");

  const phoneHTML = phone
    ? escapeHTML(phone)
    : "Phone number unavailable";

  const callButton = phone
    ? `<a class="call-btn" href="tel:+91${phone}">☎ Call Customer</a>`
    : "";

  const preparingDisabled = status === "Preparing" ? "disabled" : "";
  const readyDisabled = status === "Ready" ? "disabled" : "";

  return `
    <article class="order-card" data-order-id="${escapeHTML(id)}">
      <div class="order-head">
        <div>
          <h3 class="order-number">Order #${orderLabel}</h3>
          <p class="order-time">${escapeHTML(formatTime(order))}</p>
        </div>
        <span class="status ${getStatusClass(status)}">
          ${escapeHTML(status)}
        </span>
      </div>

      <div class="order-body">
        <p class="customer-label">Customer mobile</p>
        <div class="customer-phone">${phoneHTML}</div>
        ${callButton}

        <h4 class="items-heading">Ordered Items</h4>
        <div class="items-list">${renderItems(order.items)}</div>

        <div class="order-total">
          <span>Total Amount</span>
          <strong>${formatPrice(total)}</strong>
        </div>

        <p class="payment-note">
          Payment status: ${paymentStatus}
        </p>
      </div>

      <div class="order-actions">
        <button
          type="button"
          class="action-btn prepare-btn"
          data-action="Preparing"
          data-id="${escapeHTML(id)}"
          ${preparingDisabled}>
          🔥 Preparing
        </button>

        <button
          type="button"
          class="action-btn ready-btn"
          data-action="Ready"
          data-id="${escapeHTML(id)}"
          ${readyDisabled}>
          ✓ Ready
        </button>

        <button
          type="button"
          class="action-btn delete-btn"
          data-action="Delete"
          data-id="${escapeHTML(id)}">
          🗑 Delete Order
        </button>
      </div>
    </article>
  `;
}

function renderOrders() {
  const activeOrders = allOrders.filter(({ order }) =>
    !["Completed"].includes(String(order.status || "Received"))
  );

  activeCount.textContent = activeOrders.length;
  preparingCount.textContent = activeOrders.filter(
    ({ order }) => getStatus(order) === "Preparing"
  ).length;
  readyCount.textContent = activeOrders.filter(
    ({ order }) => getStatus(order) === "Ready"
  ).length;

  if (activeOrders.length === 0) {
    ordersList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🍽️</div>
        <h3>No active orders</h3>
        <p>New customer orders will appear here automatically.</p>
      </div>
    `;
    return;
  }

  ordersList.innerHTML = activeOrders.map(({ id, order }) =>
    renderOrder(id, order)
  ).join("");
}

async function updateOrderStatus(id, status, button) {
  if (!["Preparing", "Ready"].includes(status)) return;

  button.disabled = true;

  try {
    await updateDoc(doc(db, "orders", id), {
      status,
      updatedAt: serverTimestamp()
    });

    showNotice(`Order updated to ${status}.`);
  } catch (error) {
    console.error("Could not update order:", error);
    showNotice(
      "Order update failed. Check your Firebase connection and permissions.",
      true
    );
    button.disabled = false;
  }
}

async function removeOrder(id, button) {
  const confirmed = window.confirm(
    "Are you sure you want to permanently delete this order?"
  );

  if (!confirmed) return;

  button.disabled = true;

  try {
    await deleteDoc(doc(db, "orders", id));
    showNotice("Order deleted successfully.");
  } catch (error) {
    console.error("Could not delete order:", error);
    showNotice(
      "Could not delete order. Check Firebase permissions.",
      true
    );
    button.disabled = false;
  }
}

ordersList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (!id) return;

  if (action === "Delete") {
    await removeOrder(id, button);
  } else {
    await updateOrderStatus(id, action, button);
  }
});

refreshBtn.addEventListener("click", () => {
  renderOrders();
  showNotice("Order list refreshed.");
});

try {
  const ordersRef = collection(db, "orders");

  onSnapshot(ordersRef, snapshot => {
    connectionStatus.textContent = "Connected · Live updates";
    connectionStatus.className = "connection-status connected";

    const incomingIds = new Set(
      snapshot.docs.map(orderDoc => orderDoc.id)
    );

    if (initialSnapshotReceived) {
      const newOrdersArrived = snapshot.docChanges().some(change =>
        change.type === "added" &&
        !knownOrderIds.has(change.doc.id)
      );

      if (newOrdersArrived) {
        playBeep();
        showNotice("🔔 New customer order received!");
      }
    }

    knownOrderIds = incomingIds;
    initialSnapshotReceived = true;

    allOrders = snapshot.docs.map(orderDoc => ({
      id: orderDoc.id,
      order: orderDoc.data()
    }));

    allOrders.sort((a, b) =>
      getTimeValue(b.order) - getTimeValue(a.order)
    );

    renderOrders();
  }, error => {
    console.error("Firebase listener error:", error);

    connectionStatus.textContent = "Connection error";
    connectionStatus.className = "connection-status error";

    showNotice(
      "Orders could not load. Check Firebase setup, internet, and Firestore rules.",
      true
    );

    if (!initialSnapshotReceived) {
      ordersList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>Unable to load orders</h3>
          <p>Check your internet connection and Firebase permissions.</p>
        </div>
      `;
    }
  });
} catch (error) {
  console.error("Could not start Chef Dashboard:", error);

  connectionStatus.textContent = "Setup error";
  connectionStatus.className = "connection-status error";

  showNotice("Firebase setup error. Check firebase.js.", true);
}
