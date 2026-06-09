require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

app.use(cors({
  origin: [
    'https://founderssupport.org',
    'https://www.founderssupport.org',
    'http://localhost:3000'
  ]
}));

app.use(express.json());

// ================= DATABASE =================

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ Mongo Error:', err));

// ================= MODEL =================

const ApplicationSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  startup: String,
  problem: String,
  solution: String,
  business_model: String,
  usage: String,
  country: String,
  sex: String,
  dob: String,
  target_market: String,
  competition: String,
  funding: String,
  traction: String,
  vision: String,
  milestones: String,
  grant_type: String,
  paid: {
    type: Boolean,
    default: false
  },
  reference: String,
  paymentDate: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Application = mongoose.model('Application', ApplicationSchema);

// ================= HEALTH =================

app.get('/', (req, res) => {
  res.send('FSI Backend Running 🚀');
});

// ================= SAVE APPLICATION =================

app.post('/api/save-application', async (req, res) => {
  try {
    const appData = new Application(req.body);
    await appData.save();

    res.json({
      success: true,
      id: appData._id
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: 'Save failed'
    });
  }
});

// ================= INITIATE PAYMENT =================

app.post('/api/initiate-payment', async (req, res) => {
  try {

    const { email, name, phone } = req.body;

    const reference =
      'FSI-' +
      Date.now() +
      '-' +
      Math.random().toString(36).substring(2, 7);

    const paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: 100000, // ₦1,000 in kobo

        reference,

        callback_url:
          'https://founderssupport.org/pending.html',

        metadata: {
          name,
          phone
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await Application.findOneAndUpdate(
      {
        email,
        paid: false
      },
      {
        reference
      },
      {
        sort: {
          createdAt: -1
        }
      }
    );

    res.json({
      success: true,
      checkout_url:
        paystackRes.data.data.authorization_url,
      reference
    });

  } catch (err) {

    console.error(
      'Paystack Init Error:',
      err.response?.data || err.message
    );

    res.status(500).json({
      success: false,
      error: 'Payment initialization failed'
    });
  }
});

// ================= VERIFY PAYMENT =================

app.post('/api/verify-payment', async (req, res) => {
  try {

    const { reference } = req.body;

    if (!reference) {
      return res.json({
        success: false,
        error: 'Reference missing'
      });
    }

    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const payment = verifyRes.data.data;

    if (payment.status !== 'success') {
      return res.json({
        success: false,
        error: 'Payment not successful'
      });
    }

    await Application.findOneAndUpdate(
      { reference },
      {
        paid: true,
        paymentDate: new Date()
      }
    );

    res.json({
      success: true,
      reference: payment.reference,
      email: payment.customer.email,
      amount: payment.amount / 100
    });

  } catch (err) {

    console.error(
      'Verification Error:',
      err.response?.data || err.message
    );

    res.status(500).json({
      success: false,
      error: 'Verification failed'
    });
  }
});

// ================= PAYSTACK WEBHOOK =================

app.post('/api/paystack-webhook', async (req, res) => {

  try {

    const event = req.body;

    if (
      event.event === 'charge.success' &&
      event.data.status === 'success'
    ) {

      const reference = event.data.reference;

      await Application.findOneAndUpdate(
        { reference },
        {
          paid: true,
          paymentDate: new Date()
        }
      );

      console.log(
        '✅ Payment confirmed via webhook:',
        reference
      );
    }

    res.sendStatus(200);

  } catch (err) {

    console.error(
      'Webhook Error:',
      err.message
    );

    res.sendStatus(500);
  }
});

// ================= START SERVER =================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});