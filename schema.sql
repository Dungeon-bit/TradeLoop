-- TradeLoop MySQL schema (run once after CREATE DATABASE tradeloop)

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  seller_id INT NOT NULL,
  buyer_id INT NULL,
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sold_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_products_seller FOREIGN KEY (seller_id) REFERENCES users (id),
  CONSTRAINT fk_products_buyer FOREIGN KEY (buyer_id) REFERENCES users (id),
  INDEX idx_products_category (category),
  INDEX idx_products_available (is_available)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
