
import "./firebase.js";

const db = window.db;
const fb = window.fb;

const ordersEl = document.getElementById("orders");
const messageEl = document.getElementById("message");
const connectionEl = document.getElementById("connection");
const filterEl = document.getElementById("filterStatus");

let allOrders = [];

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[char]));
}

function orderTime(order) {
  const value = order.createdAt;
  if (value?.toDate) return value.toDate().getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function formatTime(order) {
  const ms = orderTime(order);
  return ms ? new Date(ms).toLocaleString() : "Time unavailable";
}

function render() {
  const filter = filterEl.value;
  const shown = allOrders
    .filter(order => filter === "All" || (order.status || "Received") === filter)
    .sort((a, b) => orderTime(b) - orderTime(a));

  document.getElementById("allCount").textContent = allOrders.length;
  document.getElementById("preparingCount").textContent =
    allOrders.filter(o => o.status === "Preparing").length;
  document.getElementById("readyCount").textContent =
    allOrders.filter(o => o.status === "Ready").length;

  if (!shown.length) {
    ordersEl.innerHTML = "";
    messageEl.textContent = allOrders.length
      ? "No orders match this filter."
      : "No orders yet. New customer orders will appear here.";
    return;
  }

  messageEl.textContent = `${shown.length} order(s)`;
  ordersEl.innerHTML = shown.map(order => {
    const items = Array.isArray(order.items) ? order.items : [];
    const status = order.status || "Received";
    const phone = order.customerPhone || order.mobile || "Not provided";
    const total = Number(order.total) || 0;

    return `
      <article class="order-card">
        <h3>Order #${safe(order.id.slice(-6).toUpperCase())}</h3>
        <div class="order-meta">
          <div>Customer: ${safe(order.customerName || "Customer")}</div>
          <div>Mobile: ${safe(phone)}</div>
          <div>Table: ${safe(order.tableNumber || order.table || "Not assigned")}</div>
          <div>Time: ${safe(formatTime(order))}</div>
        </div>
        <p><span class="status">${safe(status)}</span></p>
        <strong>Items</strong>
        <ul class="item-list">
          ${items.map(item => `
            <li>${safe(item.name || "Item")} × ${Math.max(0, Number(item.qty) || 0)}
              ${item.note ? `<br><small>Note: ${safe(item.note)}</small>` : ""}
            </li>
          `).join("") || "<li>Item details unavailable</li>"}
        </ul>
        ${order.notes ? `<p>Special request: ${safe(order.notes)}</p>` : ""}
        <div class="order-total">Total: ₹${total.toFixed(2)}</div>
        <div class="actions">
          ${status !== "Preparing" && status !== "Completed" && status !== "Cancelled"
            ? `<button data-status="Preparing" data-id="${safe(order.id)}">Start Preparing</button>` : ""}
          ${status !== "Ready" && status !== "Completed" && status !== "Cancelled"
            ? `<button data-status="Ready" data-id="${safe(order.id)}">Mark Ready</button>` : ""}
          ${status !== "Completed" && status !== "Cancelled"
            ? `<button class="secondary" data-status="Completed" data-id="${safe(order.id)}">Complete</button>` : ""}
          ${status !== "Cancelled" && status !== "Completed"
            ? `<button class="secondary" data-status="Cancelled" data-id="${safe(order.id)}">Cancel</button>` : ""}
        </div>
      </article>`;
  }).join("");
}

filterEl.addEventListener("change", render);

ordersEl.addEventListener("click", async event => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;

  const id = button.dataset.id;
  const status = button.dataset.status;
  button.disabled = true;

  try {
    await fb.updateDoc(fb.doc(db, "orders", id), {
      status,
      updatedAt: fb.serverTimestamp()
    });
    messageEl.textContent = `Order updated: ${status}`;
  } catch (error) {
    console.error(error);
    messageEl.textContent = "Status update failed. Check Firebase permissions and connection.";
    button.disabled = false;
  }
});

try {
  fb.onSnapshot(
    fb.collection(db, "orders"),
    snapshot => {
      allOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      connectionEl.textContent = "Live connected";
      render();
    },
    error => {
      console.error(error);
      connectionEl.textContent = "Connection error";
      messageEl.textContent = "Orders could not load. Check Firebase configuration and Firestore rules.";
    }
  );
} catch (error) {
  console.error(error);
  connectionEl.textContent = "Connection error";
  messageEl.textContent = "Firebase initialization failed.";
}
