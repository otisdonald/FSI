const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const forge = require("node-forge");
const { DOMParser } = require("xmldom");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- ENCRYPTION FUNCTION (from TransactPay docs) ---
function encryptPayload(data, rsaPubKey) {
  let rsaKeyValue = Buffer.from(rsaPubKey, 'base64').toString('utf-8');
  rsaKeyValue = rsaKeyValue.replace('4096!', '');

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(rsaKeyValue, 'text/xml');
  const modulus = xmlDoc.getElementsByTagName('Modulus')[0].textContent;
  const exponent = xmlDoc.getElementsByTagName('Exponent')[0].textContent;

  const modulusBI = new forge.jsbn.BigInteger(Buffer.from(modulus, 'base64').toString('hex'), 16);
  const exponentBI = new forge.jsbn.BigInteger(Buffer.from(exponent, 'base64').toString('hex'), 16);

  const pubKey = forge.pki.setRsaPublicKey(modulusBI, exponentBI);
  const encryptedBytes = pubKey.encrypt(forge.util.encodeUtf8(JSON.stringify(data)));
  return Buffer.from(encryptedBytes, 'binary').toString('base64');
}

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

  const rawPayload = {
    amount: 1000,
    email: email,
    name: name,
    phone: phone,
    reference: reference,
    currency: "NGN",
    description: "FSI Application Fee",
    redirectUrl: "https://fsi.onrender.com/pending.html"
  };

  try {
    console.log("🔐 Encrypting payload for:", email);

    const encryptedData = encryptPayload(rawPayload, process.env.TPAY_ENCRYPTION_KEY);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/create",
      { data: encryptedData }, // <-- ENCRYPTED
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const paymentLink = response.data?.data?.link || response.data?.data?.paymentLink || response.data?.data?.url;
    console.log("✅ Link created:", reference);

    await Application.findOneAndUpdate({ email }, { tx_ref: reference }, { upsert: true });

    res.json({ success: true, checkout_url: paymentLink, reference });

  } catch (err) {
    console.log("❌ Error:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
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