// ================= IMPORTS =================
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
 .then(() => console.log("✅ MongoDB Connected"))
 .catch(err => console.log("❌ Mongo Error:", err));

// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  startup: String,
  problem: String,
  solution: String,
  business_model: String,
  usage: String,
  paymentStatus: { type: String, default: "unpaid" },
  tx_ref: String,
  createdAt: { type: Date, default: Date.now }
}));

// ================= CONFIG =================
app.get("/api/config", (req, res) => {
  res.json({ transactpayPublicKey: process.env.TPAY_PUBLIC_KEY });
});

// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req, res) => {
  try {
    const data = req.body;
    await Application.findOneAndDelete({ email: data.email });
    const appData = await Application.create(data);
    res.json({ success: true, id: appData._id });
  } catch (err) {
    console.log("❌ Save error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= ENCRYPTION FUNCTION (FIXED FOR TRANSACTPAY) =================
function encryptPayload(payload, encryptionKey) {
  try {
    const iv = crypto.randomBytes(16);

    // TransactPay gives a long key - derive 32-byte AES key via SHA256
    const key = crypto.createHash('sha256').update(encryptionKey).digest();

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(JSON.stringify(payload), "utf8", "base64");
    encrypted += cipher.final("base64");

    return {
      iv: iv.toString("base64"),
      payload: encrypted
    };
  } catch (err) {
    console.log("❌ Encryption error:", err.message);
    throw err;
  }
}

// ================= INITIATE PAYMENT =================
app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;

  try {
    if (!process.env.TPAY_PUBLIC_KEY ||!process.env.TPAY_ENCRYPTION_KEY) {
      throw new Error("Missing TPAY_PUBLIC_KEY or TPAY_ENCRYPTION_KEY");
    }

    const payload = {
      customer: {
        firstname: name.split(" ")[0] || name,
        lastname: name.split(" ")[1] || "",
        mobile: phone,
        country: "NG",
        email
      },
      order: {
        amount: 1000,
        reference: "FSI-" + Date.now(),
        description: "FSI Application Fee",
        currency: "NGN"
      },
      payment: {
        RedirectUrl: "https://fsi.onrender.com/pending.html"
      }
    };

    // Use ENCRYPTION_KEY (not SECRET_KEY)
    const encryptedPayload = encryptPayload(payload, process.env.TPAY_ENCRYPTION_KEY);

    console.log("🔐 Initiating payment for:", email);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      encryptedPayload,
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    console.log("✅ TransactPay response:", JSON.stringify(response.data).substring(0, 200));

    const checkoutUrl = response.data?.data?.paymentLink ||
                       response.data?.paymentLink ||
                       response.data?.checkout_url;

    if (!checkoutUrl) {
      throw new Error("No payment link in response: " + JSON.stringify(response.data));
    }

    // Save tx_ref
    await Application.findOneAndUpdate(
      { email },
      { tx_ref: payload.order.reference },
      { upsert: true }
    );

    res.json({ success: true, checkout_url: checkoutUrl, reference: payload.order.reference });

  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.log("❌ Initiate error:", errorData);
    res.status(500).json({
      success: false,
      error: errorData
    });
  }
});

// ================= VERIFY PAYMENT =================
app.post("/api/verify-payment", async (req, res) => {
  const { transaction_id, email } = req.body;
  try {
    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/status",
      { transaction_id },
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const payment = response.data?.data || response.data;
    const status = (payment.status || "").toUpperCase();

    if (status!== "SUCCESS" && status!== "SUCCESSFUL") {
      return res.json({ success: false, status: payment.status });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid", tx_ref: payment.reference || transaction_id },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

// ================= HEALTH CHECK =================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1,
    has_public_key:!!process.env.TPAY_PUBLIC_KEY,
    has_encryption_key:!!process.env.TPAY_ENCRYPTION_KEY
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));