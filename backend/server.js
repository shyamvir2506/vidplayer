// Must be set before any TLS connection — required behind corporate SSL-inspection proxies
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const dubbingRoutes = require('./routes/dubbing');

const app = express();
const PORT = process.env.PORT || 5000;

['uploads', 'processed', 'temp'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Serve processed dubbed audio files statically
app.use('/processed', express.static(path.join(__dirname, 'processed')));

app.use('/api', dubbingRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
