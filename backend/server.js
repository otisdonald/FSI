// ================= IMPORTS =================
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const axios = require("axios");
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

// ================= INITIATE PAYMENT (NO ENCRYPTION) =================
app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;

  try {
    if (!process.env.TPAY_PUBLIC_KEY) {
      throw new Error("Missing TPAY_PUBLIC_KEY");
    }

    const reference = "FSI-" + Date.now();

    // Plain payload - TransactPay does NOT require encryption for checkout
    const payload = {
      customer: {
        firstname: name.split(" ")[0] || name,
        lastname: name.split(" ")[1] || "",
        mobile: phone,
        country: "NG",
        email: email
      },
      order: {
        amount: 1000,
        reference: reference,
        description: "FSI Application Fee",
        currency: "NGN"
      },
      payment: {
        RedirectUrl: "https://fsi.onrender.com/pending.html"
      }
    };

    console.log("🔐 Initiating payment for:", email);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      payload,
      {
        headers: {
          'api-key': process.env.TPAY_PUBLIC_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    console.log("✅ TransactPay:", response.data.message);

    // Get payment link
    const orderRef = response.data?.data?.order?.reference;
    const paymentLink = response.data?.data?.paymentLink ||
                       `https://checkout.transactpay.ai/${orderRef}`;

    await Application.findOneAndUpdate(
      { email },
      { tx_ref: reference },
      { upsert: true }
    );

    res.json({
      success: true,
      checkout_url: paymentLink,
      reference: reference
    });

  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.log("❌ Initiate error:", errorData);
    res.status(500).json({ success: false, error: errorData });
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
          'api-key': process.env.TPAY_PUBLIC_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const payment = response.data?.data || response.data;
    const status = String(payment.status || "").toUpperCase();

    if (status!== "SUCCESS" && status!== "SUCCESSFUL") {
      return res.json({ success: false, status });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid" },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

// ================= HEALTH =================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1,
    hasKey:!!process.env.TPAY_PUBLIC_KEY
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));