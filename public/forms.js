// public/forms.js
(function () {
  var scripts = document.currentScript ? [document.currentScript] : document.querySelectorAll("script[data-slug]");
  Array.prototype.forEach.call(scripts, function (s) {
    var slug = s.getAttribute("data-slug");
    if (!slug) return;
    var iframe = document.createElement("iframe");
    iframe.src = s.src.replace(/forms\.js.*$/, "") + "forms/" + encodeURIComponent(slug) + "/embed";
    iframe.style.cssText = "border:0;background:transparent;width:100%;display:block;";
    iframe.setAttribute("frameborder", "0");
    s.parentNode.insertBefore(iframe, s);
    window.addEventListener("message", function (e) {
      if (e.source === iframe.contentWindow && e.data && e.data.type === "tc-form-height") {
        iframe.style.height = (e.data.height + 20) + "px";
      }
    });
  });
})();
