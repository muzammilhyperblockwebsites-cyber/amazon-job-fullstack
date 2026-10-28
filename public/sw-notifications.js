self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    "https://www.jobsatamazon.co.uk/app#/jobSearch";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        if (clientList.length > 0 && "focus" in clientList[0]) {
          clientList[0].focus();
        }
      })
  );
});

