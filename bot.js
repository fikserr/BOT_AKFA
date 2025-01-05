const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
require('dotenv').config();

// Tokeningizni kiriting
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// MongoDB ulanish
const mongoUri = process.env.MONGODB_URL;
mongoose
  .connect(mongoUri)
  .then(() => console.log('MongoDB ga muvaffaqiyatli ulandi!'))
  .catch((err) => console.error('MongoDB ulanishda xatolik:', err));

// Foydalanuvchi modeli
const User = mongoose.model('User', new mongoose.Schema({
  chatId: { type: String, required: true },
  name: String,
  phone: String,
  address: String,
}));

// Tovar modeli
const Product = mongoose.model('Product', new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
}));

// Buyurtma modeli
const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  paymentType: { type: String, required: true }, // "naxt" yoki "nasiya"
  totalAmount: { type: Number, required: true },
}));

// Adminni aniqlash
const ADMIN_CHAT_ID = '339299758'; // Adminning chat ID sini shu yerga kiriting


// Tovarlarni ko'rsatish
async function showProducts(chatId) {
  const products = await Product.find();
  if (products.length === 0) {
    bot.sendMessage(chatId, 'Hozircha tovarlar mavjud emas.');
    return;
  }

  const buttons = products.map((product) => [
    {
      text: `${product.name} - $${product.price}`,
      callback_data: `product_${product._id}`,
    },
  ]);

  bot.sendMessage(chatId, 'Tovarlar ro‘yxati:', {
    reply_markup: { inline_keyboard: buttons },
  });
}

// Foydalanuvchi /start bosganda
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  let user = await User.findOne({ chatId });
  if (user) {
    bot.sendMessage(chatId, `Salom, ${user.name}! Tovarlarni tanl
      ang:`);
    showProducts(chatId);
  } else {
    bot.sendMessage(chatId, `Salom, ${msg.from.first_name}! Ismingizni kiriting:`);
    userInfo[chatId] = { step: 'name' }; // Ro'yxatdan o'tish jarayoni
  }
});
// xslkdp;wmjdl
// Ro'yxatdan o'tish
const userInfo = {};
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (userInfo[chatId] && userInfo[chatId].step === 'name') {
    userInfo[chatId].name = msg.text;
    userInfo[chatId].step = 'phone';

    bot.sendMessage(chatId, 'Telefon raqamingizni ulashing:', {
      reply_markup: {
        keyboard: [
          [
            {
              text: 'Telefon raqamni ulashish',
              request_contact: true,
            },
          ],
        ],
        one_time_keyboard: true,
      },
    });
  } else if (userInfo[chatId] && userInfo[chatId].step === 'phone' && msg.contact) {
    const phone = msg.contact.phone_number;
    const name = userInfo[chatId].name;

    const newUser = new User({ chatId, name, phone });
    await newUser.save();

    bot.sendMessage(chatId, `Ro'yxatdan o'tish muvaffaqiyatli yakunlandi! Tovarlarni tanlang.`);
    showProducts(chatId);

    delete userInfo[chatId];
  }
});

// Tovar tanlash
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('product_')) {
    const productId = data.split('_')[1];
    const product = await Product.findById(productId);

    if (!product) {
      bot.sendMessage(chatId, 'Kechirasiz, tovar topilmadi.');
      return;
    }

    bot.sendMessage(
      chatId,
      `Siz "${product.name}" tovarini tanladingiz. To'lov usulini tanlang:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Naxt', callback_data: `payment_naxt_${productId}` },
              { text: 'Nasiya', callback_data: `payment_nasiya_${productId}` },
            ],
          ],
        },
      }
    );
  } else if (data.startsWith('payment_')) {
    const [_, paymentType, productId] = data.split('_');
    const product = await Product.findById(productId);
    const user = await User.findOne({ chatId });

    if (!product || !user) {
      bot.sendMessage(chatId, 'Xatolik: foydalanuvchi yoki tovar topilmadi.');
      return;
    }

    let totalAmount = product.price;
    if (paymentType === 'nasiya') {
      totalAmount += product.price * 0.02; // 2% qo'shimcha
    }

    const newOrder = new Order({
      userId: user._id,
      productId: product._id,
      paymentType,
      totalAmount,
    });
    await newOrder.save();

    bot.sendMessage(
      chatId,
      `Buyurtma muvaffaqiyatli qabul qilindi!\nTovar: ${product.name}\nTo'lov usuli: ${paymentType === 'naxt' ? 'Naxt' : 'Nasiya'
      }\nUmumiy summa: $${totalAmount.toFixed(2)}`
    );
  }
});

// Admin tomonidan yangi tovar qo‘shish
bot.onText(/\/addProduct/, (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, 'Sizda bu buyrug‘ni ishlatishga huquq yo‘q.');
    return;
  }

  bot.sendMessage(chatId, 'Yangi tovar nomini kiriting:');
  userInfo[chatId] = { step: 'addProductName' }; // Yangi tovarni qo‘shish jarayoni
});

// Yangi tovar ma'lumotlarini qo‘shish
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (userInfo[chatId] && userInfo[chatId].step === 'addProductName') {
    userInfo[chatId].name = msg.text;
    userInfo[chatId].step = 'addProductPrice';

    bot.sendMessage(chatId, 'Tovar narxini kiriting:');
  } else if (userInfo[chatId] && userInfo[chatId].step === 'addProductPrice') {
    const price = parseFloat(msg.text);
    if (isNaN(price)) {
      bot.sendMessage(chatId, 'Iltimos, tovar narxini to‘g‘ri kiriting.');
      return;
    }

    const newProduct = new Product({
      name: userInfo[chatId].name,
      price: price,
    });
    await newProduct.save();

    bot.sendMessage(chatId, `Yangi tovar qo‘shildi:\nTovar: ${newProduct.name}\nNarx: $${newProduct.price}`);

    delete userInfo[chatId]; // Jarayonni tugatish
  }
});
