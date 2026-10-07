self.addEventListener("push", (event) => {
  let payload = {
    title: "StudioFlow",
    body: "You have a new class booking.",
    url: "/instructor",
    tag: "studioflow-booking",
  };

  if (event.data) {
    try {
      const data = event.data.json();

      if (data?.web_push === 8030 && data?.notification) {
        payload = {
          ...payload,
          title: data.notification.title || payload.title,
          body: data.notification.body || payload.body,
          url: data.notification.navigate || payload.url,
          tag: data.notification.tag || payload.tag,
        };
      } else {
        payload = { ...payload, ...data };
      }
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: {
        url: payload.url || "/instructor",
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    event.notification.data?.url || "/instructor",
    self.location.origin,
  ).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if ("focus" in client && client.url.startsWith(self.location.origin)) {
            if ("navigate" in client) {
              return client.navigate(target).then(() => client.focus());
            }
            return client.focus();
          }
        }

        return clients.openWindow(target);
      }),
  );
});
