const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "index.html")));

mongoose.connect(process.env.MONGO_URI)
 .then(() => console.log("✅ MongoDB Connected"))
 .catch(err => console.log("❌ Mongo Error:", err));

const Application = mongoose.model("Application", new mongoose.Schema({
  name: String, email: String, phone: String, startup: String,
  problem: String, solution: String, business_model: String, usage: String,
  paymentStatus: { type: String, default: "unpaid" },
  tx_ref: String, createdAt: { type: Date, default: Date.now }
}));

app.post("/api/save-application", async (req, res) => {
  try {
    await Application.findOneAndDelete({ email: req.body.email });
    const appData = await Application.create(req.body);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false }); }
});

// --- ENCRYPTION FUNCTION (Tingg/TransactPay standard) ---
function encryptPayload(payload) {
  const key = Buffer.from(process.env.TPAY_ENCRYPTION_KEY, 'base64');
  const iv = key.slice(0, 16); // first 16 bytes as IV
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;
  const reference = "FSI-" + Date.now();

  const payload = {
    amount: "1000",
    email,
    name,
    phone,
    reference,
    currency: "NGN",
    description: "FSI Application Fee",
    redirectUrl: "https://fsi.onrender.com/pending.html"
  };

  try {
    console.log("🔐 Creating payment for:", email);
    const encryptedData = encryptPayload(payload);
    console.log("🔒 Encrypted length:", encryptedData.length);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/create",
      { data: encryptedData }, // <-- encrypted payload
      { headers: { "api-key": process.env.TPAY_PUBLIC_KEY, "Content-Type": "application/json" } }
    );

    const paymentLink = response.data?.data?.link;
    console.log("✅ Link:", paymentLink);

    await Application.findOneAndUpdate({ email }, { tx_ref: reference }, { upsert: true });
    res.json({ success: true, checkout_url: paymentLink, reference });

  } catch (err) {
    console.log("❌ Error:", err.response?.data);
    res.status(500).json({ success: false, error: err.response?.data });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/status",
      { transaction_id: req.body.transaction_id },
      { headers: { "api-key": process.env.TPAY_PUBLIC_KEY } }
    );
    const status = String(response.data?.data?.status || "").toUpperCase();
    if (status.includes("SUCCESS")) {
      await Application.findOneAndUpdate({ email: req.body.email }, { paymentStatus: "paid" });
      return res.json({ success: true });
    }
    res.json({ success: false, status });
  } catch { res.status(500).json({ success: false }); }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));