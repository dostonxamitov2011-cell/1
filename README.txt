VitaHerb — yangilangan loyiha (haqiqiy Google kirish + lokatsiya + admin bot)

FAYLLAR (hammasi hosting papkasida bitta joyda, images papkasi bilan):
  index.html, script.js, style.css, api.php, images/

SOZLASH (bir martalik, 3 qadam):
1) Yangi bot tokeni: Telegramda @BotFather -> /revoke yoki /token -> yangi token oling.
   (Eski token oldin ochiq kodda turgan edi, shuning uchun uni almashtiring.)
   Tokenni api.php dagi BOT_TOKEN ga yozing. ADMIN_CHAT_ID — admin chat ID.
   Admin botga bir marta /start yozgan bo'lishi kerak.
2) Google Client ID: console.cloud.google.com -> APIs & Services -> Credentials ->
   Create credentials -> OAuth client ID -> "Web application".
   "Authorized JavaScript origins" ga sayt manzilingizni yozing (masalan https://saytingiz.uz).
   Chiqqan Client ID ni ikki joyga qo'ying: api.php (GOOGLE_CLIENT_ID) va script.js (GOOGLE_CLIENT_ID).
   OAuth consent screen ni to'ldiring va "Publish app" qiling (aks holda faqat test foydalanuvchilar kira oladi).
3) Hosting HTTPS bo'lishi shart (lokatsiya va Google faqat https da ishlaydi).
   PHP 7.4+ va cURL kerak. api.php o'zi data/ papkasini yaratadi (foydalanuvchilar, buyurtmalar).
   data/ papkasiga yozish ruxsati (755) bo'lsin.

NIMA ISHLAYDI:
- Google tugmasi orqali haqiqiy kirish; server Google tokenini tekshiradi.
- Buyurtma uchun kirish majburiy; savatchadagi hamma mahsulot, soni, narxi va jami botga boradi.
- Buyurtma paytida brauzer lokatsiyani so'raydi; lokatsiya bo'lmasa buyurtma yuborilmaydi.
- Admin botga: mijoz ismi, Gmail, telefon, manzil, xarita havolasi, jonli lokatsiya, mahsulotlar va rasmlar.
- Profil: Google rasm/ism/Gmail, telefon, buyurtmalar tarixi (serverda, boshqa qurilmada ham ko'rinadi), saqlangan manzillar.
