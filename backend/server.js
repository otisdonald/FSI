const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
    res.json({ success: true, id: appData._id });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;
  const reference = "FSI-" + Date.now();

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
      reference,
      description: "FSI Application Fee",
      currency: "NGN"
    },
    payment: {
      RedirectUrl: "https://fsi.onrender.com/pending.html"
    }
  };

  try {
    console.log("🔐 Initiating payment for:", email);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      payload,
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const order = response.data?.data?.order;
    const checkoutUrl = `https://checkout.transactpay.ai/${order.reference}`;

    console.log("✅ Order created:", order.reference);

    await Application.findOneAndUpdate({ email }, { tx_ref: reference }, { upsert: true });

    res.json({ success: true, checkout_url: checkoutUrl, reference });
  } catch (err) {
    console.log("❌ Error:", err.response?.data || err.message);
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
    if (status === "SUCCESS" || status === "SUCCESSFUL") {
      await Application.findOneAndUpdate({ email: req.body.email }, { paymentStatus: "paid" });
      return res.json({ success: true });
    }
    res.json({ success: false, status });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));