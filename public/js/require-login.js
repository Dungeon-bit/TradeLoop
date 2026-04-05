/* Redirect to login if not authenticated */
(function () {
  fetch("/api/me", { credentials: "same-origin" }).then(function (r) {
    if (!r.ok) window.location.href = "/login.html";
  });
})();
