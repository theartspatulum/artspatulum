/**
 * The Art Spa Tulum — Google review email forwarder
 * Runs inside theartspa.tulum@gmail.com (script.google.com).
 * Every 10 minutes it looks for Google's "new review" emails and sends them to the
 * Reputation Manager on the website, which drafts a reply and asks for approval in Telegram.
 *
 * 1. Paste your secret phrase below (the same value as REVIEWS_EMAIL_SECRET in Netlify).
 * 2. Run "setup" once and allow the permissions.
 */
const SECRET = 'PASTE-YOUR-SECRET-PHRASE-HERE';
const ENDPOINT = 'https://www.theartspatulum.mx/.netlify/functions/review-email';
const DONE_LABEL = 'ArtSpa-review-sent';

function checkReviewEmails() {
  const label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  const query = 'from:google.com newer_than:3d -label:' + DONE_LABEL +
    ' (review OR reseña OR reseñas OR opinión OR "left a review" OR "dejó una reseña")';
  const threads = GmailApp.search(query, 0, 20);
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({ secret: SECRET, id: msg.getId(), subject: msg.getSubject(), body: msg.getPlainBody(), date: msg.getDate() })
      });
      Logger.log(msg.getSubject() + ' -> ' + res.getResponseCode() + ' ' + res.getContentText());
    });
    thread.addLabel(label);
  });
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkReviewEmails').timeBased().everyMinutes(10).create();
  checkReviewEmails();
}
