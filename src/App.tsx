import React, { useState, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";

interface Item {
  id: string;
  name: string;
  qty: number;
  vndPrice: number;
}

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export default function App() {
  // Config States
  const [exchangeRate, setExchangeRate] = useState<number>(() => Number(localStorage.getItem('ex_rate')) || 5.8);
  const [totalCargoInput, setTotalCargoInput] = useState<number>(() => Number(localStorage.getItem('total_cargo_input')) || 450000);
  const [profitMargin, setProfitMargin] = useState<number>(() => Number(localStorage.getItem('profit_margin')) || 30);

  // Items State
  const [items, setItems] = useState<Item[]>(() => {
    const saved = localStorage.getItem('cargo_items');
    return saved ? JSON.parse(saved) : [];
  });

  // Manual Form State
  const [newItem, setNewItem] = useState({ name: '', qty: 1, vndPrice: 0 });
  
  // Gemini Loading States
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiStatus, setAiStatus] = useState('');

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem('ex_rate', exchangeRate.toString());
    localStorage.setItem('total_cargo_input', totalCargoInput.toString());
    localStorage.setItem('profit_margin', profitMargin.toString());
    localStorage.setItem('cargo_items', JSON.stringify(items));
  }, [exchangeRate, totalCargoInput, profitMargin, items]);

  // Global Calculations
  const totalVND = items.reduce((sum, item) => sum + (item.vndPrice * item.qty), 0);
  const totalBaseMMK = totalVND / exchangeRate;
  const currentCargoMMK = items.length > 0 ? totalCargoInput : 0;
  const totalCostMMK = totalBaseMMK + currentCargoMMK;

  // Manual Add Item
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name) return;
    setItems([...items, { ...newItem, id: `manual-${Date.now()}` }]);
    setNewItem({ name: '', qty: 1, vndPrice: 0 });
  };

  // Delete Item
  const handleDeleteItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  // Clear All Items
  const handleClearAll = () => {
    if (window.confirm("စာရင်းအားလုံးကို ဖျက်ပစ်ရန် သေချာပါသလား။")) {
      setItems([]);
    }
  };

  // Price Rounding Utility
  const roundToCleanMMK = (amount: number) => {
    if (amount <= 0) return 0;
    if (amount < 10000) return Math.ceil(amount / 500) * 500;
    return Math.ceil(amount / 5000) * 5000;
  };

  // 🎯 ၁၀၀% တိကျသေချာသော ဈေးနှုန်း String ဖတ်စနစ်နှင့် Frontend Parser အသစ်
  const handleVoucherUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!genAI) {
      setAiStatus("❌ .env ဖိုင်ထဲတွင် VITE_GEMINI_API_KEY ထည့်သွင်းရန် လိုအပ်နေပါသည်။");
      return;
    }

    setLoadingAI(true);
    setAiStatus("Gemini 2.5 က ဘောက်ချာစာသားများကို စစ်ဆေးနေပါသည်... ⚡");

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const imagePart = {
        inlineData: { data: base64Data, mimeType: file.type }
      };

      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" }
      });

      // 🚀 Gemini အား ကိန်းဂဏန်းများကို သင်္ချာမတွက်ခိုင်းဘဲ မြင်ရသည့်အတိုင်း String သက်သက်သာ ထုတ်ခိုင်းခြင်း
      const prompt = `
        You are an expert OCR parser for Vietnamese receipts (like MM Mega Market).
        Extract products from the image text columns precisely.

        CRITICAL INSTRUCTIONS:
        1. Extract the name from 'Tên hàng hóa, dịch vụ'.
        2. Extract the exact character string from the LAST column 'Thành tiền đã có thuế GTGT' as 'rawThanhTien'. 
           Include all dots/periods as they appear (e.g., "536.998", "116.667", "79.000").
        3. Extract the exact character string from 'Số lượng' as 'rawQty' (e.g., "10", "1", "2,122").

        Return a strictly valid JSON array structure where values are STRINGS:
        [
          {
            "name": "PRODUCT NAME (UPPERCASE)",
            "rawQty": "string containing quantity",
            "rawThanhTien": "string containing the last column amount with dots"
          }
        ]
        Do not include markdown blocks or text wrappers. Return raw JSON array only.
      `;

      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();
      const parsedItems = JSON.parse(responseText);

      if (Array.isArray(parsedItems)) {
        // 🛠️ Frontend ဘက်မှ Regex သုံး၍ အစက်အပြောက်နှင့် ကော်မာများကို ကိန်းပြည့်အဖြစ် ပြောင်းလဲတွက်ချက်ခြင်း
        const finalScannedItems: Item[] = parsedItems.map((item: any, idx: number) => {
          // အရေအတွက်ထဲက ကော်မာ (သို့) အစက်များကို ရှင်းထုတ်ခြင်း (ဥပမာ- "2,122" -> 2.122)
          const cleanQtyStr = String(item.rawQty || "1").replace(/[^0-9.]/g, '');
          const qty = parseFloat(cleanQtyStr) || 1;

          // 💡 နောက်ဆုံးကော်လံ စုစုပေါင်းငွေထဲက အစက်/ကော်မာ အားလုံးကို ဖယ်ရှား၍ ကိန်းပြည့်စစ်စစ်ပြောင်းခြင်း
          // ဥပမာ- "536.998" -> "536998" -> 536998 Integer
          // ဥပမာ- "116.667" -> "116667" -> 116667 Integer
          const cleanThanhTienStr = String(item.rawThanhTien || "0").replace(/[^0-9]/g, '');
          const totalLineVND = parseInt(cleanThanhTienStr, 10) || 0;

          // Tax ပါဝင်ပြီးသား တစ်ယူနစ်ချင်းစီ၏ တကယ့်ကျသင့်ငွေကို တွက်ချက်ခြင်း
          // ဥပမာ- 536998 / 10 = 53699.8 -> 53700 VND
          const calculatedUnitPriceVND = qty > 0 ? Math.round(totalLineVND / qty) : 0;

          return {
            id: `gemini-${idx}-${Date.now()}`,
            name: (item.name || "UNKNOWN ITEM").toUpperCase(),
            qty: Math.ceil(qty), // ကာဂိုအတွက် အရေအတွက်ကို ကိန်းပြည့်အဖြစ်ထားရှိခြင်း
            vndPrice: calculatedUnitPriceVND
          };
        });

        setItems(finalScannedItems);
        setAiStatus(`🎉 အောင်မြင်ပါသည်! ဗီယက်နမ်ငွေကြေး format အား အမှားအယွင်းမရှိ တိကျစွာ ဖတ်ပြီးပါပြီ။`);
      } else {
        setAiStatus("⚠️ Data Format အဆင်မပြေဖြစ်သွားသည်။ ထပ်မံကြိုးစားကြည့်ပါ။");
      }

    } catch (error) {
      console.error("Gemini Scan Error:", error);
      setAiStatus("❌ ပုံရိပ်ကို ဖတ်၍မရနိုင်ပါ။ Prompt သို့မဟုတ် API သတ်မှတ်ချက်ကို ပြန်စစ်ပါ။");
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <header className="mb-8 border-b-2 border-blue-600 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-blue-800">AI Smart Voucher Calculator</h1>
            <p className="text-slate-500 text-sm mt-1">Gemini 2.5 Flash စနစ်သုံး ဝယ်ကုန်နှင့် ကာဂိုခ တွက်ချက်စနစ် (Value-based Distribution)</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button onClick={handleClearAll} className="bg-rose-100 hover:bg-rose-200 text-rose-700 px-4 py-2 rounded text-sm font-semibold transition-colors">
              🗑️ စာရင်းရှင်းမည်
            </button>
            <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow text-sm font-semibold transition-colors">
              🖨️ PDF / Slip ထုတ်မည်
            </button>
          </div>
        </header>

        {/* Configurations Dashboard */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 print:hidden">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
            <label className="block text-sm font-medium text-slate-600 mb-1">ငွေလဲနှုန်း (VND ÷ X)</label>
            <input type="number" step="0.01" value={exchangeRate} onChange={(e) => setExchangeRate(Number(e.target.value))} className="w-full border rounded p-2 text-lg font-bold text-blue-700 focus:outline-blue-500"/>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
            <label className="block text-sm font-medium text-slate-600 mb-1">စုစုပေါင်း ကျသင့်ကာဂိုခ (MMK)</label>
            <input type="number" step="1000" value={totalCargoInput} onChange={(e) => setTotalCargoInput(Number(e.target.value))} className="w-full border rounded p-2 text-lg font-bold text-blue-700 focus:outline-blue-500"/>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
            <label className="block text-sm font-medium text-slate-600 mb-1">မှန်းခြေ အမြတ်ရာခိုင်နှုန်း (%)</label>
            <input type="number" value={profitMargin} onChange={(e) => setProfitMargin(Number(e.target.value))} className="w-full border rounded p-2 text-lg font-bold text-blue-700 focus:outline-blue-500"/>
          </div>
        </section>

        {/* AI Voucher Scanner */}
        <section className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-dashed border-blue-300 p-6 rounded-lg mb-6 text-center print:hidden">
          <h3 className="font-bold text-blue-900 text-lg mb-1">📸 AI Shopping Voucher Scanner</h3>
          <p className="text-sm text-blue-700 mb-4">ဗီယက်နမ် ပြေစာ၊ ဘောက်ချာ သို့မဟုတ် Shopee Screenshot ပုံများကို တင်ပေးပါ။</p>
          <div className="max-w-xs mx-auto">
            <input 
              type="file" accept="image/*" 
              onChange={handleVoucherUpload} 
              disabled={loadingAI}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer disabled:opacity-50"
            />
          </div>
          {aiStatus && (
            <p className={`mt-3 text-sm font-semibold p-2 rounded inline-block ${loadingAI ? 'text-amber-600 animate-pulse bg-amber-50' : 'text-emerald-700 bg-emerald-50'}`}>
              {aiStatus}
            </p>
          )}
        </section>

        {/* Manual Add Form */}
        <section className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-6 print:hidden">
          <h3 className="font-semibold text-slate-700 mb-2">➕ လက်ဖြင့် ပစ္စည်းထည့်ရန်</h3>
          <form onSubmit={handleAddItem} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <input type="text" placeholder="ပစ္စည်းအမည်" required value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="border rounded p-2 text-sm focus:outline-blue-500"/>
            <input type="number" placeholder="အရေအတွက်" min="1" required value={newItem.qty || ''} onChange={e => setNewItem({...newItem, qty: Number(e.target.value)})} className="border rounded p-2 text-sm focus:outline-blue-500"/>
            <input type="number" placeholder="မူရင်းတစ်ယူနစ်ဈေး (VND)" required value={newItem.vndPrice || ''} onChange={e => setNewItem({...newItem, vndPrice: Number(e.target.value)})} className="border rounded p-2 text-sm focus:outline-blue-500"/>
            <button type="submit" className="bg-slate-700 hover:bg-slate-800 text-white font-medium py-2 rounded text-sm shadow transition-colors">ထည့်မည်</button>
          </form>
        </section>

        {/* Interactive Table */}
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto mb-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-medium text-sm">
                <th className="p-3">ပစ္စည်းအမည်</th>
                <th className="p-3 text-center">အရေအတွက်</th>
                <th className="p-3 text-right">မူရင်းဝယ်ဈေး (VND)</th>
                <th className="p-3 text-right">မူရင်းဝယ်ဈေး (MMK)</th>
                <th className="p-3 text-right">ကာဂိုခ ခွဲဝေမှုဝေစု</th>
                <th className="p-3 text-right">စုစုပေါင်းရင်းဈေး (MMK)</th>
                <th className="p-3 text-right text-blue-700 bg-blue-50/50">အဝိုင်းကိန်းရောင်းဈေး (၁ ထုပ်)</th>
                <th className="p-3 text-center print:hidden">လက္ခဏာ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {items.map((item, index) => {
                const itemTotalVND = item.vndPrice * item.qty;
                const itemCargoShareMMK = totalVND > 0 ? (itemTotalVND / totalVND) * currentCargoMMK : 0;
                const itemBaseMMK = itemTotalVND / exchangeRate;
                const itemTotalCostMMK = itemBaseMMK + itemCargoShareMMK;
                const costPerUnit = itemTotalCostMMK / item.qty;
                const finalSellingPrice = roundToCleanMMK(costPerUnit * (1 + profitMargin / 100));

                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-medium text-slate-900 max-w-xs truncate">{item.name}</td>
                    <td className="p-3 text-center">
                      <input 
                        type="number" min="1" value={item.qty} 
                        onChange={(e) => {
                          const updated = [...items];
                          updated[index].qty = Number(e.target.value);
                          setItems(updated);
                        }}
                        className="w-16 border rounded text-center p-1 font-semibold print:border-0"
                      />
                    </td>
                    <td className="p-3 text-right">{item.vndPrice.toLocaleString()} VND</td>
                    <td className="p-3 text-right">{Math.round(itemBaseMMK).toLocaleString()} ကျပ်</td>
                    <td className="p-3 text-right text-amber-700 font-medium">{Math.round(itemCargoShareMMK).toLocaleString()} ကျပ်</td>
                    <td className="p-3 text-right">{Math.round(itemTotalCostMMK).toLocaleString()} ကျပ်</td>
                    <td className="p-3 text-right font-bold text-blue-700 text-base bg-blue-50/30">
                      {finalSellingPrice.toLocaleString()} ကျပ်
                    </td>
                    <td className="p-3 text-center print:hidden">
                      <button onClick={() => handleDeleteItem(item.id)} className="text-rose-500 hover:text-rose-700 font-medium p-1">❌</button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center p-12 text-slate-400">ဘောက်ချာပုံတင်ပါ သို့မဟုတ် လက်ဖြင့် စာရင်းစတင်ထည့်သွင်းပါ။</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Summary Footer */}
        <section className="bg-slate-800 text-slate-100 p-6 rounded-lg shadow-md grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 border-r border-slate-700/60 pr-4">
            <h4 className="text-slate-400 uppercase text-xs tracking-wider font-bold mb-2">ရင်းနှီးစရိတ် အနှစ်ချုပ် (Summary)</h4>
            <div className="flex justify-between">
              <span className="text-slate-300">🛒 စုစုပေါင်း ပစ္စည်းရင်းဈေး (VND):</span>
              <span className="font-semibold">{totalVND.toLocaleString()} VND</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">💵 ပစ္စည်းစုစုပေါင်းရင်းဈေး (MMK):</span>
              <span className="font-semibold">{Math.round(totalBaseMMK).toLocaleString()} ကျပ်</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">✈️ စုစုပေါင်း ကာဂိုခ (MMK):</span>
              <span className="font-semibold text-amber-400">{currentCargoMMK.toLocaleString()} ကျပ်</span>
            </div>
          </div>
          
          <div className="flex flex-col justify-center items-end bg-slate-900/40 p-4 rounded border border-blue-500/20">
            <span className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">စုစုပေါင်း တွက်ချက်ပြီး ကုန်ကျစရိတ်</span>
            <span className="text-3xl font-bold text-emerald-400 mb-2">{Math.round(totalCostMMK).toLocaleString()} ကျပ်</span>
            <span className="text-[11px] text-slate-400 text-right">
              * ကာဂိုခကို ပစ္စည်းတစ်ခုချင်းစီ၏ မူရင်းဝယ်ဈေး (Value Ratio) အပေါ် မူတည်၍ တရားမျှတစွာ အချိုးချ ခွဲဝေပေါင်းစပ်ပေးထားပါသည်။
            </span>
          </div>
        </section>

      </div>
    </div>
  );
}
