// The Art Spa Tulum — small, dependency-free site script
(function () {
  // Mobile menu
  var btn = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // SimplyBook booking widget (Book page only)
  var box = document.getElementById('sbw_booking');
  if (!box) return;
  var params = new URLSearchParams(location.search);
  var service = params.get('service');
  var predefined = {};
  if (service && /^\d+$/.test(service)) predefined.service = service;

  function init() {
    if (typeof SimplybookWidget === 'undefined') return false;
    box.innerHTML = '';
    new SimplybookWidget({
      widget_type: 'iframe',
      url: box.getAttribute('data-sb'),
      theme: 'default',
      theme_settings: {
        timeline_hide_unavailable: '1', hide_past_days: '0', timeline_show_end_time: '0',
        timeline_modern_display: 'as_slots', sb_base_color: '#141312', display_item_mode: 'block',
        booking_nav_bg_color: '#f4f1eb', body_bg_color: '#ffffff', sb_review_image: '',
        dark_font_color: '#141312', light_font_color: '#ffffff', btn_color_1: '#b23a24',
        sb_company_label_color: '#141312', hide_img_mode: '0', sb_busy: '#c7b3b3', sb_available: '#f4f1eb'
      },
      timeline: 'modern',
      datepicker: 'top_calendar',
      is_rtl: false,
      app_config: { clear_session: 0, allow_switch_to_ada: 0, predefined: predefined },
      container_id: 'sbw_booking'
    });
    return true;
  }
  if (!init()) {
    var tries = 0;
    var t = setInterval(function () {
      if (init() || ++tries > 50) {
        clearInterval(t);
        if (tries > 50) {
          // Fallback: plain iframe to the booking page (deep-linked if a service was chosen)
          var src = box.getAttribute('data-sb') + '/v2/' + (predefined.service ? '#book/service/' + predefined.service + '/count/1/' : '');
          box.innerHTML = '<iframe title="Booking" src="' + src + '" style="width:100%;min-height:760px;border:0"></iframe>';
        }
      }
    }, 100);
  }
})();
