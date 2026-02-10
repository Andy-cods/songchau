CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`content` text,
	`follow_up_at` text,
	`follow_up_done` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`company_name_local` text,
	`type` text NOT NULL,
	`industry` text,
	`industrial_zone` text,
	`province` text,
	`address` text,
	`contact_name` text,
	`contact_title` text,
	`contact_phone` text,
	`contact_email` text,
	`contact_zalo` text,
	`contact_wechat` text,
	`contact2_name` text,
	`contact2_title` text,
	`contact2_phone` text,
	`contact2_email` text,
	`smt_brands` text,
	`smt_models` text,
	`purchase_frequency` text,
	`estimated_annual_value` real,
	`payment_terms` text,
	`tier` text,
	`status` text DEFAULT 'active',
	`source` text,
	`tags` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer,
	`product_id` integer,
	`supplier_id` integer,
	`quantity` integer NOT NULL,
	`unit_price` real NOT NULL,
	`cost_price` real,
	`amount` real,
	`status` text DEFAULT 'pending',
	`supplier_order_date` text,
	`supplier_delivery_date` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text NOT NULL,
	`quotation_id` integer,
	`customer_id` integer,
	`status` text DEFAULT 'confirmed',
	`po_number` text,
	`total_amount` real,
	`currency` text DEFAULT 'VND',
	`payment_status` text DEFAULT 'unpaid',
	`paid_amount` real DEFAULT 0,
	`payment_due_date` text,
	`expected_delivery` text,
	`actual_delivery` text,
	`delivery_address` text,
	`tracking_number` text,
	`notes` text,
	`internal_notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE TABLE `pipeline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer,
	`title` text NOT NULL,
	`stage` text DEFAULT 'lead',
	`deal_value` real,
	`currency` text DEFAULT 'VND',
	`probability` integer,
	`expected_close_date` text,
	`actual_close_date` text,
	`lost_reason` text,
	`quotation_id` integer,
	`assigned_to` text,
	`notes` text,
	`tags` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_local` text,
	`slug` text NOT NULL,
	`parent_id` integer,
	`icon` text,
	`sort_order` integer DEFAULT 0,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_categories_slug_unique` ON `product_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_number` text NOT NULL,
	`name` text NOT NULL,
	`name_local` text,
	`category` text NOT NULL,
	`subcategory` text,
	`brand` text,
	`machine_model` text,
	`material` text,
	`size` text,
	`specifications` text,
	`cost_price` real,
	`cost_currency` text DEFAULT 'VND',
	`selling_price` real,
	`selling_currency` text DEFAULT 'VND',
	`margin_percent` real,
	`is_consumable` integer DEFAULT false,
	`stock_quantity` integer DEFAULT 0,
	`reorder_level` integer DEFAULT 0,
	`unit` text DEFAULT 'piece',
	`image_url` text,
	`status` text DEFAULT 'active',
	`tags` text,
	`notes` text,
	`remark` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_part_number_unique` ON `products` (`part_number`);--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quote_number` text NOT NULL,
	`customer_id` integer,
	`status` text DEFAULT 'draft',
	`subtotal` real,
	`tax_rate` real DEFAULT 10,
	`tax_amount` real,
	`total_amount` real,
	`currency` text DEFAULT 'VND',
	`valid_until` text,
	`notes` text,
	`internal_notes` text,
	`sent_at` text,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_quote_number_unique` ON `quotations` (`quote_number`);--> statement-breakpoint
CREATE TABLE `quote_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quotation_id` integer,
	`product_id` integer,
	`supplier_id` integer,
	`quantity` integer NOT NULL,
	`unit_price` real NOT NULL,
	`cost_price` real,
	`amount` real,
	`notes` text,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `supplier_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supplier_id` integer,
	`product_id` integer,
	`cost_price` real,
	`cost_currency` text DEFAULT 'USD',
	`moq` integer,
	`lead_time_days` integer,
	`last_purchase_date` text,
	`last_purchase_price` real,
	`notes` text,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`company_name_local` text,
	`country` text NOT NULL,
	`contact_name` text,
	`contact_phone` text,
	`contact_email` text,
	`contact_wechat` text,
	`contact_line` text,
	`platform` text,
	`platform_url` text,
	`rating` integer,
	`quality_score` integer,
	`delivery_score` integer,
	`price_score` integer,
	`speciality` text,
	`brands` text,
	`min_order_value` real,
	`lead_time_days` integer,
	`payment_methods` text,
	`status` text DEFAULT 'active',
	`tags` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
