import React, { useState, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";

interface Item {
  id: string;
  name: string;
  qty: number;
  vndPrice: number;
}

// Vite Environment Variable မှတစ်ဆင့် API Key ကို ချိတ်ဆက်ခြင်း
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export default function App() {
  // Config States (Local Storage)
  const [exchangeRate, setExchangeRate] = useState<number>(() => Number(localStorage.getItem('ex_rate')) || 5.8);
  
  // စုစုပေါင်း ကာဂိုခအိတ်ကြီးတစ်ခုလုံးစာ ကျသင့်ငွေ (MMK) ကို တိုက်ရိုက်ရိုက်ထည့်ရန်
  const [totalCargoInput, setTotalCargoInput] = useState<number>(() => Number(localStorage.getItem('total_cargo_input')) || 450000);
  const [profitMargin, setProfitMargin] = useState<number>(() => Number(localStorage.getItem('profit_margin')) || 30);

  // Items State (Value-based စနစ်ဖြစ်၍ weightGrams မလိုတော့ပါ)
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

  // Global Calculations (Value-based Logic)
  const totalVND = items.reduce((sum, item) => sum + (item.vndPrice * item.qty), 0);
  const totalBaseMMK = totalVND / exchangeRate;
  
  // စာရင်းထဲတွင် ပစ္စည်းရှိနေမှသာ ရိုက်ထည့်ထားသော ကာဂိုခကို ပေါင်းတွက်မည်
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

  // Clean Price Rounding Utility
  const roundToCleanMMK = (amount: number) => {
    if (amount <= 0) return 0;
    if (amount < 10000) return Math.ceil(amount / 500) * 500;
    return Math.ceil(amount / 5000) * 5000;
  };

  // ⚡ Tax ရာခိုင်နှုန်းနှင့် အမှန်ကန်ဆုံး နောက်ဆုံးကော်လံ (Total Net Amount) ကို အခြေခံ၍ တွက်ချက်မည့် စနစ်သစ်
  const handleVoucherUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!genAI) {
      setAiStatus("❌ .env ဖိုင်ထဲတွင် VITE_GEMINI_API_KEY ထည့်သွင်းရန် လိုအပ်နေပါသည်။");
      return;
    }

    setLoadingAI(true);
    setAiStatus("Gemini 2.5 က Tax အပါအဝင် ကိန်းဂဏန်းများကို အတိအကျ တွက်ချက်နေပါသည်... ⚡");

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

      // 🚀 Gemini Prompt ကို နောက်ဆုံးကော်လံ (Thanh tiền) အား အခြေခံရန် တင်းကျပ်စွာ ညွှန်ကြားခြင်း
      const prompt = `
        You are an expert OCR and retail receipt parser specializing in Vietnamese receipts (like MM Mega Market).
        Analyze the image and extract all purchased products accurately.

        CRITICAL INSTRUCTION FOR PRICE AND TAX EXTRACTION:
        1. Identify the quantity from 'So luong' column.
        2. DO NOT USE the 'Don gia' column because it excludes tax and contains confusing decimals.
        3. Go directly to the LAST COLUMN 'Thanh tien da co thue GTGT' (Total Amount with Tax included). For example, for WAKEUP coffee, this value is "536.998".
        4. Interpret the dots/periods (.) as thousands separators: "536.998" means 536998 VND integer.
        5. CALCULATE THE TRUE UNIT PRICE WITH TAX: Divide this total 'Thanh tien' integer by the 'So luong' (Quantity).
           - Example: 536998 (Total with tax) / 10 (Qty) = 53699.8 VND.
        6. Round it to the nearest clean integer and put this calculated tax-included price for ONE item into 'vndPrice' (e.g., 53700).

        Return a strictly valid JSON array structure:
        [
          {
            "name": "PRODUCT NAME AND VARIATION (Keep it clean, uppercase)",
            "qty": number (The quantity of this item),
            "vndPrice": number (The CALCULATED tax-inclusive unit cost for ONE single item in VND as a clean whole integer. e.g., 53700)
          }
        ]
        Do not include markdown blocks, text wrappers, or metadata. Return raw JSON array only.
      `;

      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();
      const parsedItems = JSON.parse(responseText);

      if (Array.isArray(parsedItems)) {
        // Frontend Double-Check: အကယ်၍ Gemini မှ အစက်အပြောက်ကြောင့် မှားယွင်းပြီး ၁၀၀၀ အောက် တန်ဖိုးများ ပေးလာခဲ့ပါက Auto-Fix လုပ်ခြင်း
        const finalScannedItems: Item[] = parsedItems.map((item: any, idx: number) => {
          let checkedVndPrice = Number(item.vndPrice) || 0;

          // Gemini က ၅၃,၇၀၀ ပြောင်းရမည့်အစား ၅၃.၇ ဟု ဒသမကိန်းအမှား ပေးလာခဲ့ပါက ၁၀၀၀ ဖြင့် မြှောက်၍ အမှန်ပြင်ဆင်ခြင်း
          if (checkedVndPrice > 0 && checkedVndPrice < 1000) {
            checkedVndPrice = checkedVndPrice * 1000;
          }

          return {
            id: `gemini-${idx}-${Date.now()}`,
            name: (item.name || "UNKNOWN ITEM").toUpperCase(),
            qty: Number(item.qty) || 1,
            vndPrice: Math.round(checkedVndPrice)
          };
        });

        setItems(finalScannedItems);
        setAiStatus(`🎉 အောင်မြင်ပါသည်! Gemini မှ Tax အပြီးအစီး ပါဝင်ပြီးသား တစ်ယူနစ်ဈေး (ဥပမာ- 53,700 VND) ဖြင့် တိကျစွာ ခွဲထုတ်ပေးပြီးပါပြီ။`);
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
            <input type="number" step="1000" value={totalCargoInput} onChange={(e) => setTotalCargoInput(Number(e.target.value))} className="w-full border rounded p-2 text-lg font-bold text-blue-700 focus:outline-blue-500" placeholder="ဥပမာ- 450000"/>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
            <label className="block text-sm font-medium text-slate-600 mb-1">မှန်းခြေ အမြတ်ရာခိုင်နှုန်း (%)</label>
            <input type="number" value={profitMargin} onChange={(e) => setProfitMargin(Number(e.target.value))} className="w-full border rounded p-2 text-lg font-bold text-blue-700 focus:outline-blue-500"/>
          </div>
        </section>

        {/* 📸 AI Voucher Scanner Sector */}
        <section className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-dashed border-blue-300 p-6 rounded-lg mb-6 text-center print:hidden">
          <h3 className="font-bold text-blue-900 text-lg mb-1">📸 AI Shopping Voucher Scanner</h3>
          <p className="text-sm text-blue-700 mb-4">ပြေစာ၊ ဘောက်ချာ သို့မဟုတ် Shopee Screenshot ပုံများကို တင်ပေးပါ။ Gemini က ၁ စက္ကန့်အတွင်း Data ပြောင်းပေးပါမည်။</p>
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

        {/* Main Interactive Table */}
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
                
                // မူရင်းဈေးအချိုးအစားအလိုက် ကာဂိုခကို ခွဲဝေတွက်ချက်ခြင်း (Value-based Cargo Distribution)
                const itemCargoShareMMK = totalVND > 0 
                  ? (itemTotalVND / totalVND) * currentCargoMMK 
                  : 0;

                const itemBaseMMK = itemTotalVND / exchangeRate;
                const itemTotalCostMMK = itemBaseMMK + itemCargoShareMMK;
                const costPerUnit = itemTotalCostMMK / item.qty;
                
                // အမြတ် % တင်ပြီး အဝိုင်းကိန်း ပြောင်းလဲခြင်း
                const finalSellingPrice = roundToCleanMMK(costPerUnit * (1 + profitMargin / 100));

                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-medium text-slate-900 max-w-xs truncate">{item.name}</td>
                    
                    {/* Inline Quantity Edit */}
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
                    
                    <td className="p-3 text-right">{itemTotalVND.toLocaleString()} VND</td>
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

        {/* Dynamic Summary Footer */}
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
