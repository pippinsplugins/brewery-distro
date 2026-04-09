/**
 * Google Apps Script — Inbound Email Webhook for SHB Distro
 *
 * This script monitors a Gmail inbox for order emails and forwards them
 * to your SHB Distro instance via webhook. It replaces direct Gmail API
 * polling so the app doesn't need the gmail.readonly OAuth scope.
 *
 * === SETUP ===
 *
 * 1. Go to https://script.google.com and create a new project.
 * 2. Paste this entire file into Code.gs (replace any existing code).
 * 3. Update the CONFIG section below with your webhook URL and token.
 * 4. Run the setup() function once (from the Run menu) to create
 *    the time-driven trigger that polls every 5 minutes.
 * 5. Authorize the script when prompted (it needs Gmail access).
 *
 * To stop: run removeTriggers() from the Run menu.
 *
 * === HOW IT WORKS ===
 *
 * Every 5 minutes the script:
 *   1. Searches for emails sent to the target address (read or unread)
 *   2. POSTs each email's data to your webhook endpoint
 *   3. Applies a "Processed" label so they aren't sent again
 */

// ─── Configuration ─────────────────────────────────────────────────
var CONFIG = {
  // Your SHB Distro webhook URL (copy from Settings > Email Order Requests)
  webhookUrl: 'https://your-app.example.com/webhooks/inbound-email',

  // Webhook authentication token (generate in Settings > Email Order Requests)
  webhookToken: 'paste-your-token-here',

  // The email address to monitor (e.g. orders@yourdomain.com)
  targetAddress: 'orders@yourdomain.com',

  // Label applied to processed emails (created automatically)
  processedLabel: 'SHB-Processed',
};

// ─── Main function — called by the time-driven trigger ─────────────

function processNewEmails() {
  var label = getOrCreateLabel(CONFIG.processedLabel);
  var query = 'to:' + CONFIG.targetAddress + ' -label:' + CONFIG.processedLabel;
  var threads = GmailApp.search(query, 0, 20);

  if (threads.length === 0) {
    Logger.log('No new emails found.');
    return;
  }

  Logger.log('Found ' + threads.length + ' thread(s) to process.');

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];

      var payload = {
        messageId: msg.getId(),
        from: msg.getFrom(),
        to: msg.getTo(),
        subject: msg.getSubject(),
        body: msg.getPlainBody() || '',
        receivedAt: msg.getDate().toISOString(),
      };

      try {
        var response = UrlFetchApp.fetch(CONFIG.webhookUrl, {
          method: 'post',
          contentType: 'application/json',
          headers: {
            'Authorization': 'Bearer ' + CONFIG.webhookToken,
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });

        var code = response.getResponseCode();
        if (code >= 200 && code < 300) {
          Logger.log('Sent message ' + msg.getId() + ' — ' + response.getContentText());
        } else {
          Logger.log('Webhook returned ' + code + ' for message ' + msg.getId() + ': ' + response.getContentText());
        }
      } catch (e) {
        Logger.log('Error sending message ' + msg.getId() + ': ' + e.message);
      }
    }

    // Apply label to entire thread so we don't reprocess it
    threads[t].addLabel(label);
  }
}

// ─── Setup — run once to create the trigger ────────────────────────

function setup() {
  // Remove any existing triggers first
  removeTriggers();

  // Create a time-driven trigger that runs every 5 minutes
  ScriptApp.newTrigger('processNewEmails')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Trigger created — processNewEmails will run every 5 minutes.');
  Logger.log('You can also run processNewEmails manually to test.');
}

// ─── Remove all triggers for this project ──────────────────────────

function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  if (triggers.length > 0) {
    Logger.log('Removed ' + triggers.length + ' trigger(s).');
  }
}

// ─── Helper: get or create Gmail label ─────────────────────────────

function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
    Logger.log('Created label: ' + name);
  }
  return label;
}
