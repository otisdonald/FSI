require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve pending.html, apply.html

// MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('Mongo error:', err));

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
  paid: { type: Boolean, default: false },
  reference: String,
  createdAt: { type: Date, default: Date.now }
});

const Application = mongoose.model('Application', ApplicationSchema);

// Save application
app.post('/api/save-application', async (req, res) => {
  try {
    const appData = new Application(req.body);
    await appData.save();
    res.json({ success: true, id: appData._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Save failed' });
  }
});

// Initiate Paystack payment
app.post('/api/initiate-payment', async (req, res) => {
  try {
    const { email, name, phone } = req.body;
    const reference = 'FSI-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: 100000, // ₦1,000 in kobo
        reference,
        callback_url: 'https://fsi.onrender.com/pending.html',
        metadata: { name, phone, custom_fields: [] }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Save reference to latest application
    await Application.findOneAndUpdate(
      { email, paid: false },
      { reference },
      { sort: { createdAt: -1 } }
    );

    res.json({
      success: true,
      checkout_url: response.data.data.authorization_url,
      reference
    });
  } catch (err) {
    console.error('Paystack init error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: 'Payment init failed' });
  }
});

// Verify payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { reference, email } = req.body;

    if (!reference) {
      return res.json({ success: false, error: 'No reference' });
    }

    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      }
    );

    const data = verifyRes.data.data;

    if (data.status === 'success') {
      // Update application
      const updated = await Application.findOneAndUpdate(
        { reference },
        { paid: true, email: data.customer.email },
        { new: true }
      );

      return res.json({ 
        success: true, 
        email: data.customer.email,
        amount: data.amount / 100,
        reference: data.reference
      });
    } else {
      return res.json({ success: false, error: 'Payment not successful' });
    }
  } catch (err) {
    console.error('Verify error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Health check
app.get('/', (req, res) => res.send('FSI Backend Running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));