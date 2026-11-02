import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Uso do dia, medido pelo próprio app (ADR-008)
export const usage = sqliteTable("usage", {
  day: text("day").primaryKey(),
  requests: integer("requests").notNull().default(0),
  rowsRead: integer("rows_read").notNull().default(0),
  rowsWritten: integer("rows_written").notNull().default(0),
  sizeBytes: integer("size_bytes").notNull().default(0),
});

export const heartbeats = sqliteTable("heartbeats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  cron: text("cron").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(), // credential id (base64url)
  userId: text("user_id").notNull(),
  publicKey: text("public_key").notNull(), // base64url
  counter: integer("counter").notNull(),
  transports: text("transports"),
  deviceName: text("device_name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  userId: text("user_id"),
  expiresAt: integer("expires_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
