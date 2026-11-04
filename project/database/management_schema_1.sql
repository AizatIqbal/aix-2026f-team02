-- Requires MySQL 8.0.16+ (CHECK constraints) and 8.0.13+ (expression defaults)
CREATE DATABASE IF NOT EXISTS business_management
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE business_management;

-- Setup can be repeated with existing tables and sales intact.

-- ---------- Parent tables first ----------

CREATE TABLE IF NOT EXISTS category (
  category_id   INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(50) NOT NULL,
  UNIQUE KEY uq_category_name (category_name)
);

-- The phone number IS the primary key, so orders can reference it
CREATE TABLE IF NOT EXISTS customer (
  customer_phone  VARCHAR(20)  NOT NULL,
  customer_name   VARCHAR(100) NOT NULL,
  customer_age    TINYINT UNSIGNED NULL,
  customer_gender VARCHAR(20)  NULL,
  PRIMARY KEY (customer_phone),
  CONSTRAINT chk_customer_age CHECK (customer_age IS NULL OR customer_age BETWEEN 0 AND 120)
);

-- The promocode IS the primary key, so orders can reference it
CREATE TABLE IF NOT EXISTS campaign (
  promocode      VARCHAR(30)   NOT NULL,
  campaign_name  VARCHAR(100)  NOT NULL,
  channel        VARCHAR(30)   NOT NULL,  -- instagram, twitter, email, etc.
  start_date     DATE          NOT NULL,
  end_date       DATE          NOT NULL,
  budget         DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,  -- fixed amount only
  PRIMARY KEY (promocode),
  CONSTRAINT chk_campaign_dates  CHECK (end_date >= start_date),
  CONSTRAINT chk_campaign_budget CHECK (budget >= 0 AND discount_value >= 0)
);

CREATE TABLE IF NOT EXISTS product (
  product_id   INT AUTO_INCREMENT PRIMARY KEY,
  category_id  INT           NOT NULL,
  product_name VARCHAR(100)  NOT NULL,
  price        DECIMAL(10,2) NOT NULL,
  KEY idx_product_category (category_id),
  CONSTRAINT fk_product_category FOREIGN KEY (category_id)
    REFERENCES category (category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_product_price CHECK (price >= 0)
);

-- ---------- Orders ----------
-- Customer and campaign links are optional for walk-in sales.
CREATE TABLE IF NOT EXISTS orders (
  order_id       INT AUTO_INCREMENT PRIMARY KEY,
  order_date     DATE NOT NULL DEFAULT (CURRENT_DATE),
  order_time     TIME NOT NULL DEFAULT (CURRENT_TIME),
  day_of_week    VARCHAR(9) GENERATED ALWAYS AS (
                   ELT(WEEKDAY(order_date) + 1,
                       'Monday','Tuesday','Wednesday','Thursday',
                       'Friday','Saturday','Sunday')
                 ) STORED,
  customer_phone VARCHAR(20) NULL,  -- same type as customer.customer_phone
  promocode      VARCHAR(30) NULL,  -- same type as campaign.promocode
  discount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  total          DECIMAL(10,2) NOT NULL DEFAULT 0,
  KEY idx_orders_customer (customer_phone),
  KEY idx_orders_campaign (promocode),
  KEY idx_orders_date (order_date),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_phone)
    REFERENCES customer (customer_phone) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_orders_campaign FOREIGN KEY (promocode)
    REFERENCES campaign (promocode) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_orders_discount CHECK (discount >= 0),
  CONSTRAINT chk_orders_total    CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS order_item (
  order_item_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT           NOT NULL,
  product_id    INT           NOT NULL,
  quantity      INT           NOT NULL,
  price         DECIMAL(10,2) NOT NULL,  -- unit price snapshot at time of sale
  KEY idx_order_item_order (order_id),
  KEY idx_order_item_product (product_id),
  CONSTRAINT fk_order_item_order FOREIGN KEY (order_id)
    REFERENCES orders (order_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_order_item_product FOREIGN KEY (product_id)
    REFERENCES product (product_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_order_item_quantity CHECK (quantity > 0),
  CONSTRAINT chk_order_item_price    CHECK (price >= 0)
);
