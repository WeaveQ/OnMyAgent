#!/usr/bin/env node

/**
 * 测试系统权限检测逻辑
 * 用于诊断 checkSystemPermissions() 的问题
 */

import { systemPreferences } from "electron";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const platform = process.platform;

console.log("=== 系统权限检测诊断 ===");
console.log(`平台: ${platform}`);
console.log(`系统版本: ${os.release()}`);
console.log(`用户主目录: ${os.homedir()}\n`);

if (platform !== "darwin") {
  console.log("⚠️  非 macOS 系统，不支持权限检测");
  process.exit(0);
}

// 1. 辅助功能
console.log("--- 辅助功能检测 ---");
try {
  const hasAccessibility = systemPreferences.isTrustedAccessibilityClient(false);
  console.log(`结果: ${hasAccessibility ? "已授权 ✓" : "未授权 ✗"}`);
} catch (e) {
  console.log(`错误: ${e.message}`);
}

// 2. 完全磁盘访问
console.log("\n--- 完全磁盘访问检测 ---");
try {
  const mailDir = path.join(os.homedir(), "Library", "Mail");
  console.log(`检测路径: ${mailDir}`);
  const canAccess = existsSync(mailDir);
  console.log(`结果: ${canAccess ? "可以访问 ✓" : "无法访问 ✗"}`);
  
  // 额外检查：尝试读取其他受保护目录
  const protectedPaths = [
    "~/Library/Mail",
    "~/Library/Messages",
    "~/Library/Safari",
  ];
  
  console.log("\n其他受保护目录访问测试:");
  for (const p of protectedPaths) {
    const fullPath = path.join(os.homedir(), ...p.slice(2).split("/"));
    const accessible = existsSync(fullPath);
    console.log(`  ${p}: ${accessible ? "✓" : "✗"}`);
  }
} catch (e) {
  console.log(`错误: ${e.message}`);
}

// 3. 自动化
console.log("\n--- 自动化权限检测 ---");
try {
  const result = execFileSync(
    "osascript",
    ["-e", 'tell application "System Events" to return 1'],
    { stdio: "pipe", timeout: 3000 }
  );
  console.log(`结果: 已授权 ✓ (返回值: ${result.toString().trim()})`);
} catch (e) {
  if (e.stderr) {
    const stderr = e.stderr.toString();
    if (stderr.includes("not allowed") || stderr.includes("-1743")) {
      console.log("结果: 未授权 ✗");
      console.log(`错误详情: ${stderr.trim()}`);
    } else {
      console.log(`错误: ${stderr.trim()}`);
    }
  } else {
    console.log(`错误: ${e.message}`);
  }
}

// 4. 通知
console.log("\n--- 通知权限检测 ---");
console.log("结果: 无法从主进程检测 (显示为 unknown)");
console.log("说明: macOS 不提供主进程 API 来查询通知权限状态");

console.log("\n=== 诊断完成 ===");
