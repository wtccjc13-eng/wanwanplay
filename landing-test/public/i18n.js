/* Textes du site : chinois traditionnel (Taïwan) par défaut + anglais.
   Les clés avec "html" autorisent du balisage (<em>, <span>) ; elles sont écrites ici, jamais saisies par un visiteur. */
(function () {
  var T = {
    zh: {
      'meta.title': '灣灣好日子 野生動物版｜認識台灣動物的親子桌遊',
      'meta.desc': '《灣灣好日子》野生動物版：2 至 6 人的動物卡牌桌遊，5 歲以上都能玩。認識台灣的動物與棲地、練習繁體中文閱讀，一起學著守護牠們。',
      'banner.sim': '測試模式｜模擬付款，不會扣款',
      'banner.np': '測試模式｜藍新金流（NewebPay）測試環境',
      'nav.order': '立即訂購',

      'hero.badge': '野生動物版',
      'hero.eyebrow': '台灣公司・方元創意出品',
      'hero.h1': '誰是台灣<em>最厲害</em>的動物？',
      'hero.lead': '<span class="zh">灣灣好日子</span>是一套專為孩子設計的動物比大小卡牌遊戲。從海裡的綠蠵龜，到高山上的臺灣黑熊，邊玩邊認識台灣的野生動物、牠們的家，也一起學著守護牠們。',
      'hero.cta': '立即訂購',
      'hero.ship': '配送至歐洲各國',
      'fact.players': '2–6 人',
      'fact.time': '約 20 分鐘',
      'fact.age': '5 歲以上・最適合 5–14 歲',

      'val.h': '玩一場遊戲，重新愛上台灣的自然',
      'val.lead': '《灣灣好日子》不只是比數字。每一回合，孩子都在認識一種動物、一個家，和一段值得被記住的故事。',
      'val.1.t': '認識台灣的動物',
      'val.1.d': '每張卡片都是一種真實生活在台灣的動物，附有照片、數據和小檔案。孩子在比大小的同時，也記住了牠們的名字和特色。',
      'val.2.t': '了解牠們的家',
      'val.2.d': '海洋、森林、草原、高山，4 種棲地各有專屬顏色。孩子很自然就會懂：不同的動物，住在不同的地方。',
      'val.3.t': '從認識開始守護',
      'val.3.d': '卡片上有「瀕危程度」標示。像臺灣梅花鹿，曾因過度獵捕而差點消失，如今透過復育計畫，慢慢回到墾丁的大自然。知道牠們的故事，就是保護牠們的第一步。',
      'val.4.t': '邊玩邊練習繁體中文',
      'val.4.d': '每張卡片的「小檔案」是一段繁體中文短文，並附上注音。孩子在遊戲中自然練習認字、讀句子，用輕鬆有趣的方式提升閱讀力，也更好奇、愛發問。',

      'hab.h': '4 大棲地，4 種顏色',
      'hab.lead': '從溫暖的珊瑚礁，到雲霧繚繞的高山，每張卡片的顏色，就是那隻動物的家。',
      'hab.swipe': '← 左右滑動，認識每一種動物 →',
      'hab.ocean': '海洋', 'hab.forest': '森林', 'hab.grass': '草原', 'hab.mountain': '高山',
      'hab.ocean.n': '綠蠵龜', 'hab.forest.n': '五色鳥', 'hab.grass.n': '臺灣梅花鹿', 'hab.mountain.n': '臺灣黑熊',
      'hab.ocean.s': '住在溫暖大海，會回沙灘產卵', 'hab.forest.s': '幫忙散播森林的種子', 'hab.grass.s': '復育中的墾丁梅花鹿', 'hab.mountain.s': '胸前有白色 V 字的「月熊」',

      'stat.h': '4 個數值，決定誰贏',
      'stat.lead': '每張卡片有 4 個數字。輪到你的時候，選一個你覺得最強的！',
      'stat.w': '體重', 'stat.w.u': '公斤',
      'stat.s': '速度', 'stat.s.u': '公里／小時',
      'stat.g': '長度', 'stat.g.u': '公分',
      'stat.v': '壽命', 'stat.v.u': '年',
      'stat.bear': '臺灣黑熊', 'stat.frog': '臺灣夜鷹鴉',

      'rule.h': '玩法超簡單',
      'rule.lead': '兩分鐘就能學會，拿起牌就能開始玩！',
      'rule.1.t': '平均發牌', 'rule.1.d': '洗牌後，每人拿相同張數的牌（2 人玩：每人 18 張；6 人玩：每人 6 張）。',
      'rule.2.t': '不偷看、不換順序', 'rule.2.d': '拿到牌以後，不可以偷看，也不可以把牌的順序換掉！',
      'rule.3.t': '選一個項目', 'rule.3.d': '第一位小朋友先看自己的第一張牌，選一個項目（體重、速度、長度或壽命），和大家比比看誰最厲害。',
      'rule.4.t': '一起翻牌', 'rule.4.d': '大家一起翻開自己的第一張牌，看看誰的數字比較大。',
      'rule.5.t': '贏的人拿走所有牌', 'rule.5.d': '數字最大的小朋友贏了這一輪，可以把大家的牌都拿走；下一輪換他先選項目。',
      'rule.6.t': '20 分鐘後比張數', 'rule.6.d': '玩 20 分鐘，時間到的時候，誰的牌最多就是贏家！',
      'duel.h': '範例：一回合',
      'duel.a': '臺灣黑熊', 'duel.b': '臺灣梅花鹿',
      'duel.pick': '體重：200 公斤 對 100 公斤',
      'duel.res': '<b>黑熊贏了這一輪</b>，拿走兩張牌！',

      'about.h': '台灣團隊出品，陪孩子重新愛上台灣',
      'about.lead': '《灣灣好日子》由台灣公司方元創意有限公司（Fangyuan Creative）出品，團隊位於台北。我們想讓孩子從海洋到高山，重新發現身邊的奇妙自然。',
      'about.1': '全部內容為繁體中文，小檔案附注音，孩子可以自己讀',
      'about.2': '2–6 人、約 20 分鐘，不需要螢幕，親子、手足、同學都能一起玩',
      'about.3': '[ 36 ] 張動物卡牌，涵蓋海洋、森林、草原、高山 4 大棲地',
      'about.4': '5 歲以上都能玩，最適合 5 至 14 歲的孩子',

      'ord.h': '立即訂購',
      'ord.lead': '填寫收件資訊，有優惠碼的話也一併輸入，再線上付款。',
      'ord.bar': '灣灣好日子・野生動物版',
      'ord.tag': '訂單',
      'f.name': '收件人姓名', 'f.phone': '聯絡電話（含國碼）', 'f.email': '電子信箱',
      'f.address': '地址（街道與門牌號碼）', 'f.zip': '郵遞區號', 'f.city': '城市', 'f.country': '國家', 'f.country.ph': '請選擇',
      'f.promo': '優惠碼', 'f.promo.ph': '例如 TEST10', 'f.apply': '套用',
      'f.qty': '數量',
      'f.ship.note': '目前配送歐洲地區（歐盟、瑞士、英國、挪威）。運費 [ 待補 ]。',
      'sum.sub': '小計', 'sum.disc': '折扣', 'sum.ship': '運費', 'sum.total': '總計',
      'sum.pay': '前往付款',
      'sum.secure': '🔒 由藍新金流（NewebPay）提供安全的線上刷卡，我們不會儲存你的卡號。',
      'promo.ok': '已套用優惠碼 ✓',
      'sum.twd': '結帳時，藍新金流將以新台幣 {n} 扣款（參考匯率；實際入帳金額依你的發卡銀行匯率，可能略有差異）。',
      'err.PROMO_UNKNOWN': '找不到這組優惠碼。',
      'err.PROMO_EXPIRED': '這組優惠碼已過期。',
      'err.PROMO_EXHAUSTED': '這組優惠碼已被使用完畢。',
      'err.FIELDS_MISSING': '請把收件資訊填寫完整。',
      'err.EMAIL_INVALID': '電子信箱格式不正確。',
      'err.PHONE_INVALID': '手機號碼格式不正確。',
      'err.ZIP_INVALID': '郵遞區號格式不正確。',
      'err.COUNTRY_INVALID': '請選擇配送國家。',
      'err.GENERIC': '發生錯誤，請稍後再試。',

      'faq.h': '常見問題',
      'faq.1.q': '適合幾歲的孩子？', 'faq.1.a': '5 歲以上都能玩，最適合 5 至 14 歲的孩子，大人一起玩也很有趣。內含小卡片，不適合 3 歲以下幼兒。',
      'faq.2.q': '還不太會認字，也能玩嗎？', 'faq.2.a': '可以。比大小只要認得數字就能玩；小檔案附有注音，也可以請大人陪著一起讀。',
      'faq.3.q': '多久會收到商品？', 'faq.3.a': '付款完成後約 [ 待補 ] 個工作天寄達歐洲各地，並會寄出訂單確認信。',
      'faq.4.q': '付款方式與幣別？', 'faq.4.a': '網站以歐元（€）標價，目前提供信用卡付款。結帳時由藍新金流（NewebPay）以新台幣扣款，金額依參考匯率換算，帳單上的實際金額以你的發卡銀行匯率為準。',
      'faq.5.q': '優惠碼怎麼使用？', 'faq.5.a': '在訂購區輸入優惠碼，按「套用」，折扣就會顯示在總計裡。',

      'foot.main': '© 2026 WanWan Play 萬玩・方元創意有限公司（Fangyuan Creative）',
      'foot.privacy': '隱私權政策', 'foot.terms': '服務條款', 'foot.contact': '聯絡我們',
      'foot.todo': '[ 待補：統一編號、公司地址、客服信箱、歐盟 14 天猶豫期（退貨）與增值稅（VAT）說明 ]',

      'ok.t': '感謝你的訂購！', 'ok.d': '我們已收到你的付款，訂單確認信會寄到你的信箱。', 'ok.ref': '訂單編號：', 'ok.back': '回到首頁',
      'ko.t': '付款尚未完成', 'ko.d': '這次沒有扣款，你可以隨時重新訂購。', 'ko.back': '回到訂購頁'
    },

    en: {
      'meta.title': '灣灣好日子 Wildlife Edition | Taiwan animal card game for kids — WanWan Play',
      'meta.desc': 'WanWan Play\'s 灣灣好日子 Wildlife Edition: a card game for 2–6 players, ages 5+. Discover Taiwan\'s animals and habitats, practise reading Traditional Chinese, and learn how to protect them.',
      'banner.sim': 'TEST MODE | simulated payment, no charge',
      'banner.np': 'TEST MODE | NewebPay test environment',
      'nav.order': 'Order now',

      'hero.badge': 'Wildlife Edition',
      'hero.eyebrow': 'By a Taiwanese company · Fangyuan Creative',
      'hero.h1': 'Which of Taiwan\'s animals is the <em>mightiest</em>?',
      'hero.lead': '<span class="zh">灣灣好日子</span> is a card game that pits Taiwan\'s wild animals against each other, from the green sea turtle of the ocean to the Formosan black bear of the high mountains. Kids discover the animals, the places they live, and how to help protect them.',
      'hero.cta': 'Order now',
      'hero.ship': 'Delivered across Europe',
      'fact.players': '2–6 players',
      'fact.time': 'About 20 min',
      'fact.age': 'Ages 5+ · best for 5–14',

      'val.h': 'One game to fall in love with Taiwan\'s nature',
      'val.lead': 'It\'s more than comparing numbers. Every round, kids meet an animal, its home, and a story worth remembering.',
      'val.1.t': 'Meet Taiwan\'s wildlife',
      'val.1.d': 'Every card is a real animal found in Taiwan, with a photo, key stats and a short profile. Kids remember names and traits while they play.',
      'val.2.t': 'Discover their homes',
      'val.2.d': 'Ocean, forest, grassland and mountain each have their own color. Kids quickly learn that different animals live in different places.',
      'val.3.t': 'Protection starts with knowing',
      'val.3.d': 'Each card shows how endangered the animal is. The Formosan sika deer was once hunted to near disappearance; today, restoration programs are bringing it back to the wild around Kenting. Knowing their stories is the first step to protecting them.',
      'val.4.t': 'Reading practice in Traditional Chinese',
      'val.4.d': 'The profile on each card is a short text in Traditional Chinese with zhuyin (注音) alongside. Kids practise recognizing characters and reading sentences in a fun, relaxed way, and stay curious.',

      'hab.h': '4 habitats, 4 colors',
      'hab.lead': 'From warm coral reefs to misty mountains, a card\'s color is the animal\'s home.',
      'hab.swipe': '← Swipe to meet each animal →',
      'hab.ocean': 'Ocean', 'hab.forest': 'Forest', 'hab.grass': 'Grassland', 'hab.mountain': 'Mountain',
      'hab.ocean.n': 'Green sea turtle', 'hab.forest.n': 'Taiwan barbet', 'hab.grass.n': 'Formosan sika deer', 'hab.mountain.n': 'Formosan black bear',
      'hab.ocean.s': 'Lives in warm seas, nests on beaches', 'hab.forest.s': 'Helps spread the forest\'s seeds', 'hab.grass.s': 'Recovering around Kenting', 'hab.mountain.s': 'Known for the white V on its chest',

      'stat.h': '4 stats decide who wins',
      'stat.lead': 'Every card shows 4 numbers. On your turn, pick the one you think is strongest!',
      'stat.w': 'Weight', 'stat.w.u': 'kg',
      'stat.s': 'Speed', 'stat.s.u': 'km/h',
      'stat.g': 'Length', 'stat.g.u': 'cm',
      'stat.v': 'Lifespan', 'stat.v.u': 'years',
      'stat.bear': 'Black bear', 'stat.frog': 'Frogmouth',

      'rule.h': 'How to play',
      'rule.lead': 'Learn it in two minutes and start playing right away!',
      'rule.1.t': 'Deal equally', 'rule.1.d': 'Shuffle, then give each player the same number of cards (2 players: 18 each; 6 players: 6 each).',
      'rule.2.t': 'No peeking, no reordering', 'rule.2.d': 'Once you have your cards, don\'t peek and don\'t change their order!',
      'rule.3.t': 'Pick a stat', 'rule.3.d': 'The first player looks at their top card and picks a stat (weight, speed, length or lifespan) to compare with everyone.',
      'rule.4.t': 'Flip together', 'rule.4.d': 'Everyone flips their top card at the same time and compares that number.',
      'rule.5.t': 'Highest takes all', 'rule.5.d': 'The player with the highest number wins the round and takes everyone\'s cards, then chooses the next stat.',
      'rule.6.t': 'Count after 20 minutes', 'rule.6.d': 'Play for 20 minutes. When time is up, whoever has the most cards wins!',
      'duel.h': 'Example round',
      'duel.a': 'Black bear', 'duel.b': 'Sika deer',
      'duel.pick': 'Weight: 200 kg vs 100 kg',
      'duel.res': '<b>The bear wins the round</b> and takes both cards!',

      'about.h': 'From a Taiwanese team, to help kids fall for Taiwan again',
      'about.lead': '灣灣好日子 is published by Fangyuan Creative (方元創意有限公司), a Taiwanese company based in Taipei. We want kids to rediscover the wonders of nature around them, from the sea to the high mountains.',
      'about.1': 'All content is in Traditional Chinese, with zhuyin on the profiles so kids can read on their own',
      'about.2': '2–6 players, about 20 minutes, no screens: great for parents, siblings and classmates',
      'about.3': '[ 36 ] animal cards across 4 habitats: ocean, forest, grassland and mountain',
      'about.4': 'Ages 5 and up, best for kids aged 5 to 14',

      'ord.h': 'Order now',
      'ord.lead': 'Enter your delivery details, add a promo code if you have one, then pay online.',
      'ord.bar': '灣灣好日子 · Wildlife Edition',
      'ord.tag': 'Order',
      'f.name': 'Recipient name', 'f.phone': 'Phone (with country code)', 'f.email': 'Email',
      'f.address': 'Address (street and number)', 'f.zip': 'Postal code', 'f.city': 'City', 'f.country': 'Country', 'f.country.ph': 'Select',
      'f.promo': 'Promo code', 'f.promo.ph': 'e.g. TEST10', 'f.apply': 'Apply',
      'f.qty': 'Quantity',
      'f.ship.note': 'We currently deliver across Europe (EU, Switzerland, UK, Norway). Shipping fee: [ TBD ].',
      'sum.sub': 'Subtotal', 'sum.disc': 'Discount', 'sum.ship': 'Shipping', 'sum.total': 'Total',
      'sum.pay': 'Continue to payment',
      'sum.secure': '🔒 Secure card payment by NewebPay. We never see or store your card number.',
      'promo.ok': 'Promo code applied ✓',
      'sum.twd': 'At checkout, NewebPay will charge about NT${n} (indicative rate; the amount on your statement depends on your bank\'s conversion and may differ slightly).',
      'err.PROMO_UNKNOWN': 'This promo code was not found.',
      'err.PROMO_EXPIRED': 'This promo code has expired.',
      'err.PROMO_EXHAUSTED': 'This promo code is no longer available.',
      'err.FIELDS_MISSING': 'Please fill in all delivery fields.',
      'err.EMAIL_INVALID': 'Please enter a valid email address.',
      'err.PHONE_INVALID': 'Please enter a valid phone number.',
      'err.ZIP_INVALID': 'Please enter a valid postal code.',
      'err.COUNTRY_INVALID': 'Please select a delivery country.',
      'err.GENERIC': 'Something went wrong. Please try again.',

      'faq.h': 'FAQ',
      'faq.1.q': 'What age is it for?', 'faq.1.a': 'Anyone aged 5 and up can play; it works best for kids aged 5 to 14, and adults enjoy it too. It contains small cards and is not suitable for children under 3.',
      'faq.2.q': 'Can kids who can\'t read much yet play?', 'faq.2.a': 'Yes. Comparing numbers is enough to play, and the profiles come with zhuyin, so a grown-up can read along.',
      'faq.3.q': 'When will I receive my order?', 'faq.3.a': 'About [ TBD ] business days after payment, by home delivery. You will get an order confirmation email.',
      'faq.4.q': 'Which currency and payment methods?', 'faq.4.a': 'Prices are in euros (€) and you pay by credit card. NewebPay processes the payment in New Taiwan dollars (NT$) at an indicative rate; your bank\'s own conversion applies to your statement.',
      'faq.5.q': 'How do I use a promo code?', 'faq.5.a': 'Enter it in the order section and press "Apply". The discount appears in your total.',

      'foot.main': '© 2026 WanWan Play 萬玩 · Fangyuan Creative (方元創意有限公司)',
      'foot.privacy': 'Privacy policy', 'foot.terms': 'Terms', 'foot.contact': 'Contact',
      'foot.todo': '[ TBD: company tax ID (統一編號), address, support email, EU 14-day withdrawal right and VAT information ]',

      'ok.t': 'Thank you for your order!', 'ok.d': 'We\'ve received your payment. A confirmation email is on its way.', 'ok.ref': 'Order: ', 'ok.back': 'Back to home',
      'ko.t': 'Payment not completed', 'ko.d': 'You were not charged. You can order again anytime.', 'ko.back': 'Back to order'
    }
  };

  var lang = 'zh';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    var saved = null;
    try { saved = localStorage.getItem('ww-lang'); } catch (e) {}
    lang = q === 'en' || q === 'zh' ? q : saved === 'en' ? 'en' : 'zh';
  } catch (e) {}

  var I18N = {
    get lang() { return lang; },
    t: function (k) { return (T[lang] && T[lang][k]) || T.zh[k] || k; },
    money: function (cents) { return '€' + (Number(cents) / 100).toFixed(2); },
    twd: function (n) { return Number(n).toLocaleString('en-US'); },
    apply: function () {
      document.documentElement.lang = lang === 'en' ? 'en' : 'zh-TW';
      document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = I18N.t(el.getAttribute('data-i18n')); });
      document.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = I18N.t(el.getAttribute('data-i18n-html')); });
      document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', I18N.t(el.getAttribute('data-i18n-ph'))); });
      document.querySelectorAll('[data-i18n-alt]').forEach(function (el) { el.setAttribute('alt', I18N.t(el.getAttribute('data-i18n-alt'))); });
      var m = document.querySelector('meta[name="description"]'); if (m) m.setAttribute('content', I18N.t('meta.desc'));
      if (document.documentElement.hasAttribute('data-has-title')) document.title = I18N.t('meta.title');
      document.querySelectorAll('[data-lang]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false'); });
      document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
    },
    set: function (l) {
      lang = l === 'en' ? 'en' : 'zh';
      try { localStorage.setItem('ww-lang', lang); } catch (e) {}
      I18N.apply();
    }
  };
  window.I18N = I18N;
  window.COUNTRIES = [
    ['FR', '法國', 'France'], ['BE', '比利時', 'Belgium'], ['CH', '瑞士', 'Switzerland'], ['LU', '盧森堡', 'Luxembourg'],
    ['DE', '德國', 'Germany'], ['NL', '荷蘭', 'Netherlands'], ['IT', '義大利', 'Italy'], ['ES', '西班牙', 'Spain'],
    ['PT', '葡萄牙', 'Portugal'], ['GB', '英國', 'United Kingdom'], ['IE', '愛爾蘭', 'Ireland'], ['AT', '奧地利', 'Austria'],
    ['DK', '丹麥', 'Denmark'], ['SE', '瑞典', 'Sweden'], ['FI', '芬蘭', 'Finland'], ['NO', '挪威', 'Norway'],
    ['PL', '波蘭', 'Poland'], ['CZ', '捷克', 'Czechia'], ['SK', '斯洛伐克', 'Slovakia'], ['HU', '匈牙利', 'Hungary'],
    ['SI', '斯洛維尼亞', 'Slovenia'], ['HR', '克羅埃西亞', 'Croatia'], ['RO', '羅馬尼亞', 'Romania'], ['BG', '保加利亞', 'Bulgaria'],
    ['GR', '希臘', 'Greece'], ['CY', '賽普勒斯', 'Cyprus'], ['MT', '馬爾他', 'Malta'], ['EE', '愛沙尼亞', 'Estonia'],
    ['LV', '拉脫維亞', 'Latvia'], ['LT', '立陶宛', 'Lithuania']
  ];
})();
