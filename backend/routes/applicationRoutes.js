const express = require("express");
const router = express.Router();
const axios = require("axios");
const Application = require("../models/Application");

// VERIFY PAYMENT + SAVE APPLICATION
router.post("/verify-payment", async (req, res) => {
  const { transaction_id, email } = req.body;

  try {
    // VERIFY TRANSACTION WITH FLUTTERWAVE
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`
        }
      }
    );

    const payment = response.data.data;

    if (payment.status !== "successful") {
      return res.json({ success:false, message:"Payment not successful" });
    }

    // UPDATE APPLICATION PAYMENT STATUS
    await Application.findOneAndUpdate(
      { email },
      {
        paymentStatus: "paid",
        tx_ref: payment.tx_ref
      }
    );

    res.json({ success:true });

  } catch (error) {
    console.log("VERIFY ERROR:", error.message);
    res.status(500).json({ success:false });
  }
});

module.exports = router;