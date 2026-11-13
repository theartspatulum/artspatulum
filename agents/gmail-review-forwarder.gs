/**
 * The Art Spa Tulum — Google review email forwarder (v2)
 * Remembers each email individually, so new reviews inside an old conversation are not missed.
 */
const SECRET = 'PASTE-YOUR-SECRET-PHRASE-HERE';
const ENDPOINT = 'https://www.theartspatulum.mx/.netlify/functions/review-email';

function checkReviewEmails() {
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty('doneIds') || '[]');
  const query = 'from:google.com newer_than:3d (review OR reseña OR reseñas OR opinión OR "left a review" OR "dejó una reseña")';
  const threads = GmailApp.search(query, 0, 30);
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const id = msg.getId();
      if (done.indexOf(id) !== -1) return;
      if (msg.getDate() < new Date(Date.now() - 3 * 24 * 3600 * 1000)) return;
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({ secret: SECRET, id: id, subject: msg.getSubject(), body: msg.getPlainBody(), date: msg.getDate() })
      });
      Logger.log(msg.getSubject() + ' -> ' + res.getResponseCode() + ' ' + res.getContentText());
      if (res.getResponseCode() === 200) done.push(id);
    });
  });
  props.setProperty('doneIds', JSON.stringify(done.slice(-300)));
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkReviewEmails').timeBased().everyMinutes(10).create();
  checkReviewEmails();
}
