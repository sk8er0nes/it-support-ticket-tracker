const express = require("express");
const mysql2 = require("mysql2/promise");
const ejs = require("ejs");
const expressLayouts = require('express-ejs-layouts');
const dotenv = require("dotenv");

dotenv.config();


const app = express();
const port = 3000;

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true,
    port: process.env.DB_PORT
}

const db = mysql2.createPool(dbConfig);

const statuses = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
const priorities = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

app.set("view engine", "ejs");
app.set("views", "./views");
app.locals.statuses = statuses;
app.locals.priorities = priorities;
app.use(express.urlencoded({ extended: false }));

async function rows(sql, values = []) {
  const [result] = await db.execute(sql, values);
  return result;
}

function render(res, page, title, locals = {}) {
  res.render('layout', { page, title, ...locals });
}

function input(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validId(value) {
  return /^[1-9]\d*$/.test(value) && Number(value) <= 4294967295;
}

function validIssueDateTime(value) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return false;
  const timestamp = new Date(value + 'Z');
  return Number.isFinite(timestamp.getTime()) &&
    timestamp.toISOString().startsWith(value.length === 16 ? value + ':00' : value);
}

async function options() {
  const [users, categories] = await Promise.all([
    rows('SELECT user_id, full_name, role FROM users ORDER BY full_name'),
    rows('SELECT category_id, name FROM categories ORDER BY name'),
  ]);
  return { users, categories, agents: users.filter(user => user.role === 'agent') };
}

async function findTicket(req, res, next) {
  const { id } = req.params;
  const [ticket] = validId(id) ? await rows('SELECT * FROM tickets WHERE ticket_id = ?', [id]) : [];
  if (!ticket) return res.status(404).send('Ticket not found.');
  res.locals.ticket = ticket;
  next();
}

app.get('/', (req, res) => res.redirect('/tickets'));

app.get('/tickets', async (req, res) => {
  const filters = {
    subject: input(req.query.subject), category_id: input(req.query.category_id),
    assignee_id: input(req.query.assignee_id), status: input(req.query.status),
  };
  if (filters.subject.length > 150 ||
      [filters.category_id, filters.assignee_id].some(value => value && !validId(value)) ||
      (filters.status && !Object.hasOwn(statuses, filters.status))) {
    return res.status(400).send('Invalid search filters.');
  }
  const conditions = [];
  const values = [];
  if (filters.subject) {
    conditions.push('LOCATE(?, t.subject) > 0');
    values.push(filters.subject);
  }
  for (const field of ['category_id', 'assignee_id', 'status']) {
    if (filters[field]) {
      conditions.push('t.' + field + ' = ?');
      values.push(filters[field]);
    }
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const [tickets, lists] = await Promise.all([
    rows(`SELECT t.ticket_id, t.subject, t.status, t.priority,
                 c.name AS category, a.full_name AS assignee
          FROM tickets t
          JOIN categories c ON c.category_id = t.category_id
          JOIN users a ON a.user_id = t.assignee_id
          ${where}
          ORDER BY t.ticket_id ASC`, values),
    options(),
  ]);
  render(res, 'index', 'Support Tickets', { tickets, filters, ...lists });
});

app.get('/tickets/new', async (req, res) => {
  render(res, 'create-ticket-entry', 'Add New Ticket', {
    ticket: { priority: 'medium', status: 'open' }, error: '', ...await options(),
  });
});

app.get('/tickets/:id/edit', findTicket, async (req, res) => {
  render(res, 'edit-ticket-entry', 'Edit Ticket', { error: '', ...await options() });
});

async function saveTicket(req, res) {
  const existing = res.locals.ticket;
  const ticket = { ticket_id: existing?.ticket_id };
  for (const field of ['subject', 'description', 'requester_id', 'assignee_id', 'category_id', 'priority', 'status', 'issue_dateTime', 'resolution']) {
    ticket[field] = input(req.body?.[field]);
  }
  const lists = await options();
  const { subject, description, requester_id, assignee_id, category_id, priority, status } = ticket;
  const exists = (records, key, value) =>
    validId(value) && records.some(record => String(record[key]) === value);

  let error = '';
  if (!ticket.issue_dateTime) {
    error = 'Enter the issue date and time.';
  } else if (status === 'resolved' && !ticket.resolution) {
    error = 'Enter a resolution before saving this ticket as Resolved.';
  } else if (ticket.issue_dateTime && !validIssueDateTime(ticket.issue_dateTime)) {
    error = 'Enter a valid issue date and time.';
  } else if (Buffer.byteLength(ticket.resolution, 'utf8') > 65535) {
    error = 'The resolution is too long.';
  } else if (!subject || subject.length > 150 || !description ||
      !exists(lists.users, 'user_id', requester_id) ||
      !exists(lists.agents, 'user_id', assignee_id) ||
      !exists(lists.categories, 'category_id', category_id) ||
      !Object.hasOwn(priorities, priority) || !Object.hasOwn(statuses, status)) {
    error = 'Enter a subject and description and select valid values for every dropdown.';
  }

  if (error) {
    return render(res.status(422), existing ? 'edit-ticket-entry' : 'create-ticket-entry',
      existing ? 'Edit Ticket' : 'Add New Ticket', {
        ticket, error, ...lists,
      });
  }

  const issueDateTime = ticket.issue_dateTime.replace('T', ' ');
  const values = [
    subject, description, requester_id, assignee_id, category_id, priority, status,
    issueDateTime, ticket.resolution || null,
  ];
  if (existing) {
    await rows(`UPDATE tickets
                SET subject = ?, description = ?, requester_id = ?, assignee_id = ?,
                    category_id = ?, priority = ?, status = ?, issue_dateTime = ?, resolution = ?,
                    resolved_at = CASE
                      WHEN ? = 'resolved' THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
                      WHEN ? = 'closed' THEN resolved_at
                      ELSE NULL END
                WHERE ticket_id = ?`, [...values, status, status, existing.ticket_id]);
  } else {
    await rows(`INSERT INTO tickets
                (subject, description, requester_id, assignee_id, category_id, priority, status, issue_dateTime, resolution, resolved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'resolved', CURRENT_TIMESTAMP, NULL))`,
      [...values, status]);
  }
  res.redirect(303, '/tickets');
}

app.post('/tickets', saveTicket);
app.post('/tickets/:id/edit', findTicket, saveTicket);

app.get('/tickets/:id/delete', findTicket, (req, res) => {
  render(res, 'delete-ticket-entry', 'Delete Ticket');
});
app.post('/tickets/:id/delete', findTicket, async (req, res) => {
  await rows('DELETE FROM tickets WHERE ticket_id = ?', [res.locals.ticket.ticket_id]);
  res.redirect(303, '/tickets');
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).send('Unable to process the request.');
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});