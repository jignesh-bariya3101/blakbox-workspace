import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const password = "password1";
const artifacts = join(process.cwd(), "e2e", "artifacts");
mkdirSync(artifacts, { recursive: true });

function fail(message) {
  throw new Error(message);
}

async function register(page, email) {
  await page.goto(`${baseURL}/register`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Your workspaces" }).waitFor();
}

async function login(page, email) {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Your workspaces" }).waitFor();
}

const stamp = Date.now();
const ownerEmail = `owner-${stamp}@example.com`;
const memberEmail = `member-${stamp}@example.com`;
const txtPath = join(tmpdir(), `blakbox-${stamp}.txt`);
writeFileSync(txtPath, "hello from the ui test\n");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${baseURL}/`);
  await page.getByRole("heading", { name: /Private files/ }).waitFor();
  await page.screenshot({ path: join(artifacts, "01-home.png"), fullPage: true });

  await page.goto(`${baseURL}/not-a-real-route`);
  await page.getByRole("heading", { name: "Page not found" }).waitFor();

  await register(page, ownerEmail);
  await page.getByRole("heading", { name: "Your workspaces" }).waitFor();
  await page.screenshot({ path: join(artifacts, "02-signed-in-home.png"), fullPage: true });

  await page.getByLabel("New workspace").fill("Legal vault");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Legal vault" }).click();
  await page.getByRole("heading", { name: "Legal vault" }).waitFor();
  await page.getByRole("heading", { name: "Members" }).waitFor();
  await page.getByRole("heading", { name: "Invite people" }).waitFor();
  await page.getByRole("heading", { name: "Activity" }).waitFor();
  await page.screenshot({ path: join(artifacts, "03-workspace.png"), fullPage: true });

  await page.getByLabel("Upload a document").setInputFiles(txtPath);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("link", { name: `blakbox-${stamp}.txt` }).click();
  await page.getByRole("heading", { name: `blakbox-${stamp}.txt` }).waitFor();

  await page.getByLabel("Rename").fill("notes.txt");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByRole("heading", { name: "notes.txt" }).waitFor();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  if (download.suggestedFilename() !== "notes.txt") {
    fail(`download name ${download.suggestedFilename()}`);
  }

  const shareResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/share-links") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Create share link" }).click();
  const shareBody = await (await shareResponse).json();
  await page.getByLabel("Share link URL").waitFor();
  await page.screenshot({ path: join(artifacts, "04-document.png"), fullPage: true });

  const guest = await browser.newPage();
  await guest.goto(`${baseURL}/share/${shareBody.shareLink.token}`);
  await guest.getByRole("heading", { name: "Shared file" }).waitFor({ timeout: 20_000 });
  await guest.close();

  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke" }).waitFor({ state: "hidden" });

  await page.getByRole("link", { name: "Workspace" }).click();
  const inviteResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/invitations") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.getByLabel("Email").fill(memberEmail);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const inviteBody = await (await inviteResponse).json();
  await page.getByText(memberEmail).waitFor();
  await page.screenshot({ path: join(artifacts, "05-invite.png"), fullPage: true });

  const memberPage = await browser.newPage();
  await memberPage.goto(`${baseURL}/invite/${inviteBody.invitation.token}`);
  await memberPage.getByText("Sign in or register").waitFor();
  await memberPage.getByRole("main").getByRole("link", { name: "Create account" }).click();
  await memberPage.getByLabel("Email").fill(memberEmail);
  await memberPage.getByLabel("Password").fill(password);
  await memberPage.getByRole("button", { name: "Create account" }).click();
  await memberPage.getByText("You were invited to Legal vault").waitFor();
  await memberPage.getByRole("button", { name: "Accept invitation" }).click();
  await memberPage.getByRole("heading", { name: "Legal vault" }).waitFor();
  if ((await memberPage.getByRole("heading", { name: "Invite people" }).count()) !== 0) {
    fail("member should not see invite panel");
  }
  await memberPage.screenshot({ path: join(artifacts, "06-member.png"), fullPage: true });

  await page.getByRole("link", { name: "Workspaces" }).click();
  await page.getByRole("link", { name: "Legal vault" }).click();
  await page.getByRole("button", { name: "Make admin" }).click();
  await page.locator(".member-list").getByText("ADMIN").waitFor();
  await page.getByRole("button", { name: "Make member" }).click();
  await page.locator(".audit-list").getByText("workspace.created").waitFor();

  await page.getByRole("link", { name: "notes.txt" }).click();
  await page.getByRole("heading", { name: "notes.txt" }).waitFor();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("heading", { name: "Legal vault" }).waitFor();
  await page.getByText("No files yet").waitFor();

  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await page.locator(".member-list").getByText("ADMIN · you").waitFor();
  await page.getByRole("button", { name: "Leave" }).waitFor();
  if ((await page.getByRole("button", { name: "Delete workspace" }).count()) !== 0) {
    fail("former owner should not delete workspace");
  }

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.getByRole("link", { name: "Sign in" }).waitFor();
  await login(page, ownerEmail);
  await page.getByRole("link", { name: "Legal vault" }).click();
  await page.locator(".member-list").getByText("ADMIN · you").waitFor();
  await page.getByRole("button", { name: "Leave" }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.getByRole("heading", { name: "Your workspaces" }).waitFor();

  await memberPage.reload();
  await memberPage.getByRole("heading", { name: "Legal vault" }).waitFor();
  await memberPage.getByRole("button", { name: "Delete workspace" }).click();
  await memberPage.getByRole("heading", { name: "Your workspaces" }).waitFor();
  await memberPage.screenshot({ path: join(artifacts, "07-after-delete.png"), fullPage: true });
  await memberPage.close();

  await page.goto(`${baseURL}/workspaces/00000000-4000-8000-8000-000000000000`);
  await page.getByRole("heading", { name: "Workspace not found" }).waitFor();
  await page.goto(`${baseURL}/unauthorized`);
  await page.getByRole("heading", { name: "You do not have access" }).waitFor();

  console.log("E2E UI: all flows passed");
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await page.close();
  await browser.close();
}
