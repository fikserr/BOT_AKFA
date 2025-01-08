const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();
// Tokeningizni kiriting
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const app = express();
const port = process.env.PORT || 3000; // Portni sozlash

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
// MongoDB ulanish
const mongoUri = process.env.MONGODB_URL;
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Ulanish uchun maksimal vaqt (5 soniya)
  socketTimeoutMS: 45000, // So'rovning maksimal davomiyligi (45 soniya)
};
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

const Cart = mongoose.model('Cart', new mongoose.Schema({
  chatId: { type: String, required: true },
  products: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      quantity: { type: Number, required: true },
    },
  ],
}));

// Buyurtma modeli
const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      quantity: { type: Number, required: true },
    },
  ],
  totalAmount: { type: Number, required: true },
  paymentMethod: { type: String, required: true }, // To'lov usuli
}));


const userInfo = {};

// Savatcha (xotira uchun, vaqtinchalik)
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
    bot.sendMessage(chatId, `Salom, ${user.name}! Tovarlarni tanlang:`);
    showProducts(chatId);
  } else {
    bot.sendMessage(chatId, `Salom, ${msg.from.first_name}! Ismingizni kiriting:`);
    userInfo[chatId] = { step: 'name' }; // Ro'yxatdan o'tish jarayoni
  }
});

const cart = {}; // Savatcha uchun global obyekt

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  if (data === 'showProducts') {
    showProducts(chatId); // Tovarlarni ko'rsatish
  }
  if (data.startsWith('product_')) {
    // Tovar ID'sini olish
    const productId = data.split('_')[1];
    const product = await Product.findById(productId);

    if (!product) {
      bot.sendMessage(chatId, 'Kechirasiz, tovar topilmadi.');
      return;
    }

    // Savatcha mavjud bo'lmasa, yangi savatcha yaratish
    cart[chatId] = cart[chatId] || [];
    const existingItem = cart[chatId].find((item) => item.productId === productId);

    if (existingItem) {
      bot.sendMessage(chatId, 'Bu tovar savatchada mavjud. Iltimos, miqdorni kiritib yangilang.');
    } else {
      if (!cart[chatId]) {
        // Agar savatcha bo'lmasa, yangi savatcha yaratish
        cart[chatId] = [];
      }

      if (cart[chatId].length === 0) {
        cart[chatId].push({ productId, name: product.name, price: product.price, quantity: 0 });
        bot.sendMessage(chatId, `"${product.name}" savatchaga qo‘shildi. Iltimos, qancha dona olishni yozing.`);
      } else {
        cart[chatId].push({ productId, name: product.name, price: product.price, quantity: 1 });
        bot.sendMessage(chatId, `"${product.name}" savatchaga qo'shildi!`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Savatchani ko\'rish', callback_data: 'view_cart' },
                { text: 'Zakaz berish', callback_data: 'checkout' },
              ],
            ],
          },
        });
      }
    }



  } else if (data === 'view_cart') {
    const userCart = cart[chatId];

    if (!userCart || userCart.length === 0) {
      bot.sendMessage(chatId, "Savatchangiz bo'sh.");
      return;
    }

    let totalAmount = 0;
    const summary = userCart
      .map((item, index) => {
        const itemTotal = item.price * item.quantity;
        totalAmount += itemTotal;
        return `${index + 1}. ${item.name} - ${item.quantity} dona - $${itemTotal.toFixed(2)}`;
      })
      .join('\n');

    bot.sendMessage(chatId, `Savatcha:\n${summary}\n\nUmumiy summa: $${totalAmount.toFixed(2)}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Zakaz berish', callback_data: 'checkout' },
            { text: 'Davom etish', callback_data: 'continue_shopping' },
          ],
        ],
      },
    });
  } else if (data === 'checkout') {
    const userCart = cart[chatId];

    if (!userCart || userCart.length === 0) {
      bot.sendMessage(chatId, "Savatchangiz bo'sh.");
      return;
    }

    let totalAmount = 0;
    const summary = userCart
      .map((item, index) => {
        const itemTotal = item.price * item.quantity;
        totalAmount += itemTotal;
        return `${index + 1}. ${item.name} - ${item.quantity} dona - $${itemTotal.toFixed(2)}`;
      })
      .join('\n');

    // Foydalanuvchi manzilini so'rash
    bot.sendMessage(chatId, `Savatcha:\n${summary}\n\nUmumiy summa: $${totalAmount.toFixed(2)}\n\nIltimos, manzilingizni kiriting:`);
    userInfo[chatId] = { step: 'address', totalAmount, summary }; // Manzilni so'rash uchun keyingi bosqichni o'rnatish
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (userInfo[chatId] && userInfo[chatId].step === 'address') {
        const address = text;

        if (!address || address.trim() === "") {  // Manzil bo'sh bo'lsa
          bot.sendMessage(chatId, "Iltimos, manzilingizni kiriting.");
          return;
        }

        console.log(text); // Manzilni tekshirish

        // Manzilni saqlash
        const user = await User.findOne({ chatId });
        if (user) {
          user.address = address;
          await user.save();
        } else {
          await User.create({
            chatId,
            name: msg.from.first_name,
            address,
          });
        }


        // Manzilni saqlash va keyingi bosqichga o'tish
        if (userInfo[chatId]) {
          userInfo[chatId].address = address; // Manzilni saqlash
        } else {
          // Agar userInfo[chatId] mavjud bo'lmasa, uni yaratish
          userInfo[chatId] = { address: address, step: 'payment' };
        }

        userInfo[chatId].step = 'payment'; // To'lov bosqichiga o'tish
        bot.sendMessage(chatId, `Manzilingiz saqlandi: ${address}`);
        // To'lov usulini so'rash
        bot.sendMessage(chatId, 'To‘lov usulini tanlang:', {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Naxt to\'lov', callback_data: 'payment_cash' },
                { text: 'Nasiya to\'lov', callback_data: 'payment_credit' },
              ],
            ],
          },
        });
      }
    });

  } else if (data === 'payment_cash' || data === 'payment_credit') {
    const userCart = cart[chatId];
    const user = await User.findOne({ chatId });
    if (!userInfo[chatId] || !userInfo[chatId].address) {
      bot.sendMessage(chatId, "Manzilingiz aniqlanmadi. Iltimos, buyurtmani qayta boshlang.");
      return;
    }
    if (!userCart || userCart.length === 0) {
      bot.sendMessage(chatId, "Savatchangiz bo'sh.");
      return;
    }

    const orderPaymentMethod = data === 'payment_cash' ? 'Naxt' : 'Nasiya';
    let totalAmount = userInfo[chatId]?.totalAmount || 0;

    if (orderPaymentMethod === 'Nasiya') {
      totalAmount += totalAmount * 0.02; // 2% qo'shish
    }

    const orderDetails = userCart
      .map((item, index) => `${index + 1}. ${item.name} - ${item.quantity} dona - $${(item.price * item.quantity).toFixed(2)}`)
      .join('\n');

    bot.sendMessage(
      chatId,
      `Buyurtma muvaffaqiyatli qabul qilindi!\nManzil: ${userInfo[chatId].address}\nTo'lov usuli: ${orderPaymentMethod}\nUmumiy summa: $${totalAmount.toFixed(2)}`
    );

    // Adminga xabar yuborish
    bot.sendMessage(
      ADMIN_CHAT_ID,
      `Yangi buyurtma:\nFoydalanuvchi: ${user.name}\nManzil: ${userInfo[chatId].address}\nBuyurtmalar:\n${orderDetails}\nUmumiy summa: $${totalAmount.toFixed(2)}`
    );

    // Savatchani tozalash
    delete cart[chatId];
    delete userInfo[chatId];
  }
  else if (data === 'continue_shopping') {
    bot.sendMessage(chatId, "Davom etishingiz mumkin. Tovar tanlang:");
    // Bu yerda foydalanuvchiga yangi tovarlarni tanlash uchun tugmalarni ko'rsatishingiz mumkin.
  }
});





// Miqdor kiritish
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (cart[chatId] && cart[chatId].length > 0) {
    const currentItem = cart[chatId][cart[chatId].length - 1];

    if (!isNaN(text) && Number(text) > 0) {
      currentItem.quantity = Number(text);
      bot.sendMessage(chatId, `"${currentItem.name}" (${currentItem.quantity} dona) savatchaga qo‘shildi.`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Savatchani ko‘rish', callback_data: 'checkout' },
              { text: 'Tovarlarni ko‘rish', callback_data: 'showProducts' }, // callback_data qiymatini to'g'rilash
            ],
          ],
        },
      });
    }
  }
});




bot.onText(/\/addProduct/, async (msg) => {
  const chatId = ADMIN_CHAT_ID;

  if (chatId !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "Sizda bu buyruqni bajarishga ruxsat yo'q.");
    return;
  }

  bot.sendMessage(chatId, "Yangi tovarni qo'shish uchun nomini kiriting:");
  userInfo[chatId] = { step: 'add_product_name' }; // Yangi tovar qo'shish jarayonini boshlash
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (userInfo[chatId] && userInfo[chatId].step === 'add_product_name') {
    // Tovar nomini olish
    userInfo[chatId].name = text;
    userInfo[chatId].step = 'add_product_price'; // Keyingi bosqichga o'tish
    bot.sendMessage(chatId, "Endi tovarning narxini kiriting:");
    return;
  }

  if (userInfo[chatId] && userInfo[chatId].step === 'add_product_price') {
    // Tovar narxini olish
    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) {
      bot.sendMessage(chatId, "Iltimos, to'g'ri narx kiriting.");
      return;
    }

    const newProduct = new Product({
      name: userInfo[chatId].name,
      price,
    });

    await newProduct.save();
    bot.sendMessage(chatId, `"${newProduct.name}" nomli yangi tovar muvaffaqiyatli qo'shildi.`);

    // Jarayonni yakunlash
    delete userInfo[chatId];
  }
});
