-- Run once on a fresh MariaDB database.
CREATE DATABASE it_support_tracker CHARACTER SET utf8mb4;
USE it_support_tracker;

-- DDL
CREATE TABLE users (
    user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'requester',
    department VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE categories (
    category_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    description VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE tickets (
    ticket_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    subject VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    requester_id INT UNSIGNED NOT NULL,
    assignee_id INT UNSIGNED NOT NULL,
    category_id INT UNSIGNED NOT NULL,
    priority ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
    status ENUM('open', 'in_progress', 'resolved', 'closed', 'cancelled') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    resolved_at DATETIME DEFAULT NULL,
    CONSTRAINT fk_tickets_requester FOREIGN KEY (requester_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_tickets_assignee FOREIGN KEY (assignee_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_tickets_category FOREIGN KEY (category_id)
        REFERENCES categories (category_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- DML: Seed parent tables before inserting tickets.
START TRANSACTION;

INSERT INTO users (user_id, full_name, email, role, department) VALUES
    (1, 'Mei Tan', 'mei.tan@example.com', 'requester', 'Finance'),
    (2, 'Arjun Lim', 'arjun.lim@example.com', 'requester', 'Operations'),
    (3, 'Nur Hassan', 'nur.hassan@example.com', 'agent', 'IT'),
    (4, 'Daniel Lee', 'daniel.lee@example.com', 'agent', 'IT');

INSERT INTO categories (category_id, name, description) VALUES
    (1, 'Hardware', 'Laptops, monitors, and other equipment'),
    (2, 'Software', 'Application errors and installation requests'),
    (3, 'Network', 'Wi-Fi and VPN connectivity issues');

INSERT INTO tickets (
    subject, description, requester_id, assignee_id, category_id,
    priority, status, created_at, updated_at, resolved_at
) VALUES
    ('Laptop will not start', 'The laptop shuts down after showing the logo.',
     1, 3, 1, 'high', 'open', '2026-11-19 09:00:00', '2026-11-19 09:00:00', NULL),
    ('Spreadsheet crashes', 'The application closes when opening the monthly report.',
     1, 4, 2, 'medium', 'in_progress', '2026-11-19 09:30:00', '2026-11-19 10:00:00', NULL),
    ('VPN connection timed out', 'The connection failed from home.',
     2, 3, 3, 'high', 'resolved', '2026-11-19 10:00:00', '2026-11-19 10:45:00',
     '2026-11-19 10:45:00');

COMMIT;