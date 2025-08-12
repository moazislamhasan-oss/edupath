// Minimal auth server: stores accounts in accounts.json (hashed)
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// serve your static site (index.html, etc.)
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'accounts.json');

// helper: read & write JSON atomically-ish
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw || '{"users":[]}');
  } catch {
    return { users: [] };
  }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// SIGN UP
app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  const db = readDB();
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), name, email, passwordHash };
  db.users.push(user);
  writeDB(db);

  return res.status(201).json({ id: user.id, name: user.name, email: user.email });
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const db = readDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  // in a real app you’d issue a session/JWT; we just return profile
  return res.json({ id: user.id, name: user.name, email: user.email });
});

const UNIVERSITIES_PATH = path.join(__dirname, 'universities.json');

// helpers for universities
function readUniversities() {
  try {
    const raw = fs.readFileSync(UNIVERSITIES_PATH, 'utf8');
    const json = JSON.parse(raw || '{"items":[]}');
    return Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}

// GET all universities (optional basic filters via query params)
app.get('/api/universities', (req, res) => {
  const { q, type, college } = req.query; // q=name search, type=Public/Private/National, college=faculty name
  let data = readUniversities();

  if (q) {
    const s = String(q).toLowerCase();
    data = data.filter(u => u.name.toLowerCase().includes(s));
  }
  if (type) {
    data = data.filter(u => u.type === type);
  }
  if (college) {
    data = data.filter(u => (u.colleges || []).some(c => c.name === college));
  }

  res.json({ items: data, total: data.length });
});

// GET single university by id
app.get('/api/universities/:id', (req, res) => {
  const id = Number(req.params.id);
  const uni = readUniversities().find(u => u.id === id);
  if (!uni) return res.status(404).json({ error: 'Not found' });
  res.json(uni);
});


// Path to applications.json
const APPLICATIONS_PATH = path.join(__dirname, 'applications.json');

// Helper to read applications
function readApplications() {
  try {
    const raw = fs.readFileSync(APPLICATIONS_PATH, 'utf8');
    const json = JSON.parse(raw || '[]');
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn('Could not read applications.json, returning empty array', err);
    return [];
  }
}

// Helper to write applications
function writeApplications(data) {
  fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Ensure applications.json exists on startup
if (!fs.existsSync(APPLICATIONS_PATH)) {
  writeApplications([]);
}

// SUBMIT APPLICATION
app.post('/api/apply', (req, res) => {
  const { fullName, birthDate, nationalId, address, phoneNumber, total, paymentMethod, college, email: applicantEmail } = req.body;

  // Validate required fields
  if (!fullName || !birthDate || !nationalId || !address || !phoneNumber || !college) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Load current user to verify identity (optional: match email)
  const db = readDB();
  const user = db.users.find(u => u.email === applicantEmail);
  if (!user) {
    return res.status(403).json({ error: 'Unauthorized: User not found' });
  }

  // Create application object
  const newApplication = {
    id: Date.now(), // unique timestamp-based ID
    userId: user.id,
    fullName,
    birthDate,
    nationalId,
    address,
    phoneNumber,
    total,
    paymentMethod,
    applicantEmail,
    college,
    status: 'Pending',
    submittedAt: new Date().toISOString()
  };

  // Read existing apps, append, save
  const apps = readApplications();
  apps.push(newApplication);
  writeApplications(apps);

  // Respond with success
  return res.status(201).json({ message: 'Application submitted successfully', applicationId: newApplication.id });
});

// GET: Number of applications submitted by a user
app.get('/api/applications/count', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const apps = readApplications();
  const count = apps.filter(app => app.applicantEmail === email).length;
  res.json({ count });
});


// GET all applications (for admin)
app.get('/api/applications', (req, res) => {
  const apps = readApplications();
  res.json(apps);
});

// DELETE an application
app.delete('/api/applications/:id', (req, res) => {
  const id = Number(req.params.id);
  const apps = readApplications();
  const filtered = apps.filter(app => app.id !== id);
  if (apps.length === filtered.length) return res.status(404).json({ error: 'Not found' });
  writeApplications(filtered);
  res.json({ message: 'Deleted successfully' });
});


// GET all users (admin only - be careful in production!)
app.get('/api/accounts', (req, res) => {
  const db = readDB();
  res.json(db);
});

// PUT /api/universities/:id - Update university
app.put('/api/universities/:id', (req, res) => {
  const id = Number(req.params.id);
  const updatedUni = req.body;
  const data = readUniversities();

  const index = data.findIndex(u => u.id === id);
  if (index === -1) return res.status(404).json({ error: 'University not found' });

  // Preserve ID
  updatedUni.id = id;
  data[index] = updatedUni;
  writeUniversities({ items: data }); // assuming your file is { items: [...] }
  res.json(updatedUni);
});

// POST /api/universities - Create new
app.post('/api/universities', (req, res) => {
  const newUni = req.body;
  newUni.id = Date.now(); // generate ID
  const data = readUniversities();
  data.push(newUni);
  writeUniversities({ items: data });
  res.status(201).json(newUni);
});

// DELETE /api/universities/:id
app.delete('/api/universities/:id', (req, res) => {
  const id = Number(req.params.id);
  const data = readUniversities();
  const filtered = data.filter(u => u.id !== id);
  if (data.length === filtered.length) return res.status(404).json({ error: 'Not found' });
  writeUniversities({ items: filtered });
  res.json({ message: 'Deleted successfully' });
});

function writeUniversities(data) {
  fs.writeFileSync(UNIVERSITIES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EduPath auth server running on http://localhost:${PORT}`));
