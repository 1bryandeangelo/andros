import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// SUPABASE CONFIG — Fill these in to connect to your backend
// Leave empty to use local storage (offline mode)
// ============================================================
const SUPABASE_URL = 'https://lkjpqejqzbvgjbbojppl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxranBxZWpxemJ2Z2piYm9qcHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDM3OTEsImV4cCI6MjA4NjExOTc5MX0.qpgSl4pN3-S0rkp3vgRJxDRdbjTWlGQ_q4I-ZkI3TRo';
const USE_SUPABASE = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

// ============================================================
// SUPABASE CLIENT (only initialized if keys are present)
// ============================================================

let supabase = null;

function getSupabase() {
  if (!USE_SUPABASE) return null;
  if (supabase) return supabase;
  // Minimal Supabase client using fetch — no SDK needed
  supabase = {
    url: SUPABASE_URL,
    key: SUPABASE_ANON_KEY,
    token: null,

    headers() {
      const h = { 'apikey': this.key, 'Content-Type': 'application/json' };
      if (this.token) h['Authorization'] = `Bearer ${this.token}`;
      return h;
    },

    async auth_signUp(email, password, name) {
      const res = await fetch(`${this.url}/auth/v1/signup`, {
        method: 'POST', headers: { 'apikey': this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, data: { name } })
      });
      const data = await res.json();
      if (data.access_token) this.token = data.access_token;
      return data;
    },

    async auth_signIn(email, password) {
      const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'apikey': this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.access_token) this.token = data.access_token;
      return data;
    },

    async auth_signOut() {
      if (this.token) {
        await fetch(`${this.url}/auth/v1/logout`, {
          method: 'POST', headers: this.headers()
        }).catch(() => {});
      }
      this.token = null;
    },

    async auth_getUser() {
      if (!this.token) return null;
      const res = await fetch(`${this.url}/auth/v1/user`, { headers: this.headers() });
      if (!res.ok) return null;
      return await res.json();
    },

    async from(table) {
      return new SupabaseQuery(this, table);
    },

    async select(table, params = {}) {
      let url = `${this.url}/rest/v1/${table}?select=*`;
      if (params.eq) { for (const [k, v] of Object.entries(params.eq)) url += `&${k}=eq.${v}`; }
      if (params.gte) { for (const [k, v] of Object.entries(params.gte)) url += `&${k}=gte.${v}`; }
      if (params.lte) { for (const [k, v] of Object.entries(params.lte)) url += `&${k}=lte.${v}`; }
      if (params.order) url += `&order=${params.order}`;
      const res = await fetch(url, { headers: this.headers() });
      return res.ok ? await res.json() : [];
    },

    async insert(table, rows) {
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST', headers: { ...this.headers(), 'Prefer': 'return=representation' },
        body: JSON.stringify(rows)
      });
      return res.ok ? await res.json() : null;
    },

    async upsert(table, rows) {
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Prefer': 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
      return res.ok ? await res.json() : null;
    },

    async delete(table, params = {}) {
      let url = `${this.url}/rest/v1/${table}?`;
      if (params.eq) { for (const [k, v] of Object.entries(params.eq)) url += `${k}=eq.${v}&`; }
      const res = await fetch(url, { method: 'DELETE', headers: this.headers() });
      return res.ok;
    },

    async update(table, data, params = {}) {
      let url = `${this.url}/rest/v1/${table}?`;
      if (params.eq) { for (const [k, v] of Object.entries(params.eq)) url += `${k}=eq.${v}&`; }
      const res = await fetch(url, {
        method: 'PATCH', headers: { ...this.headers(), 'Prefer': 'return=representation' },
        body: JSON.stringify(data)
      });
      return res.ok ? await res.json() : null;
    }
  };
  return supabase;
}

// ============================================================
// DATA LAYER — abstracts Supabase vs localStorage
// ============================================================

const LocalStore = {
  get(key, fallback = null) { try { const v = localStorage.getItem(`andros_${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`andros_${key}`, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem(`andros_${key}`); } catch {} },
};

const DataLayer = {
  async signUp(email, password, name) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      const data = await sb.auth_signUp(email, password, name);
      if (data.error) return { error: data.error.message || data.msg || 'Signup failed' };
      if (data.access_token) {
        LocalStore.set('sb_token', data.access_token);
        return { user: { id: data.user?.id, email, name } };
      }
      // Email confirmation might be required
      return { user: { id: data.id || data.user?.id, email, name }, needsConfirmation: true };
    }
    const user = { email, name, joinedAt: new Date().toISOString() };
    LocalStore.set('user', user);
    return { user };
  },

  async signIn(email, password) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      const data = await sb.auth_signIn(email, password);
      if (data.error) return { error: data.error_description || data.msg || 'Login failed' };
      LocalStore.set('sb_token', data.access_token);
      const profile = await sb.select('profiles', { eq: { id: data.user.id } });
      return { user: { id: data.user.id, email, name: profile[0]?.name || email.split('@')[0] } };
    }
    const user = { email, name: email.split('@')[0], joinedAt: new Date().toISOString() };
    LocalStore.set('user', user);
    return { user };
  },

  async signOut() {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      await sb.auth_signOut();
      LocalStore.remove('sb_token');
    }
    LocalStore.remove('user');
  },

  async restoreSession() {
    if (USE_SUPABASE) {
      const token = LocalStore.get('sb_token');
      if (!token) return null;
      const sb = getSupabase();
      sb.token = token;
      const authUser = await sb.auth_getUser();
      if (!authUser || authUser.error) { LocalStore.remove('sb_token'); return null; }
      const profile = await sb.select('profiles', { eq: { id: authUser.id } });
      return {
        id: authUser.id, email: authUser.email,
        name: profile[0]?.name || authUser.user_metadata?.name || authUser.email.split('@')[0],
        isPremium: profile[0]?.is_premium || false,
      };
    }
    return LocalStore.get('user');
  },

  // CHECKINS
  async getCheckins(userId) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      const rows = await sb.select('checkins', { eq: { user_id: userId } });
      const map = {};
      rows.forEach(r => {
        if (!map[r.date]) map[r.date] = [];
        map[r.date].push(r.habit_id);
      });
      return map;
    }
    return LocalStore.get('checkins', {});
  },

  async toggleCheckin(userId, habitId, date, currentlyChecked) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      if (currentlyChecked) {
        await sb.delete('checkins', { eq: { user_id: userId, habit_id: habitId, date } });
      } else {
        await sb.insert('checkins', [{ user_id: userId, habit_id: habitId, date }]);
      }
      return;
    }
    const checkins = LocalStore.get('checkins', {});
    const day = checkins[date] || [];
    checkins[date] = currentlyChecked ? day.filter(id => id !== habitId) : [...day, habitId];
    LocalStore.set('checkins', checkins);
  },

  // MOOD
  async getMoodLogs(userId) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      const rows = await sb.select('mood_logs', { eq: { user_id: userId } });
      const map = {};
      rows.forEach(r => { map[r.date] = { value: r.value, note: r.note }; });
      return map;
    }
    return LocalStore.get('moods', {});
  },

  async logMood(userId, date, value) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      await sb.upsert('mood_logs', [{ user_id: userId, date, value }]);
      return;
    }
    const moods = LocalStore.get('moods', {});
    moods[date] = { value, time: new Date().toISOString() };
    LocalStore.set('moods', moods);
  },

  // SLEEP
  async getSleepLogs(userId) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      const rows = await sb.select('sleep_logs', { eq: { user_id: userId } });
      const map = {};
      rows.forEach(r => { map[r.date] = { hours: parseFloat(r.hours) }; });
      return map;
    }
    return LocalStore.get('sleep', {});
  },

  async logSleep(userId, date, hours) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      await sb.upsert('sleep_logs', [{ user_id: userId, date, hours }]);
      return;
    }
    const sleep = LocalStore.get('sleep', {});
    sleep[date] = { hours, time: new Date().toISOString() };
    LocalStore.set('sleep', sleep);
  },

  // PREMIUM
  async getPremiumStatus(userId) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      const rows = await sb.select('profiles', { eq: { id: userId } });
      return rows[0]?.is_premium || false;
    }
    return LocalStore.get('premium', false);
  },

  async setPremium(userId, value) {
    if (USE_SUPABASE) {
      const sb = getSupabase();
      await sb.update('profiles', { is_premium: value }, { eq: { id: userId } });
      return;
    }
    LocalStore.set('premium', value);
  },

  // STRIPE CHECKOUT
  async createCheckout(userId, email) {
    if (!USE_SUPABASE) {
      // In offline mode, just toggle premium locally
      LocalStore.set('premium', true);
      return { offline: true };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ user_id: userId, email }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },
};

// ============================================================
// DATA & CONSTANTS
// ============================================================

const DEFAULT_HABITS = [
  { id: 'sleep', name: '7-9 hours sleep', category: 'Sleep & Recovery', icon: '🌙', science: 'Sleep is the #1 testosterone recovery tool. Studies show men who sleep <5 hours have 10-15% lower T levels. Deep sleep triggers the largest T release of the day.' },
  { id: 'no-alcohol', name: 'No alcohol', category: 'Sleep & Recovery', icon: '🚫', science: 'Alcohol directly suppresses testosterone production and increases estrogen. Even moderate drinking (2-3 drinks) can reduce T by 6.8% for up to 24 hours.' },
  { id: 'sunlight', name: '15min morning sunlight', category: 'Sunlight & Vitamin D', icon: '☀️', science: 'Morning sunlight exposure boosts Vitamin D synthesis, which is directly linked to testosterone production. Men with sufficient Vitamin D have significantly higher T levels.' },
  { id: 'vitamin-d', name: 'Vitamin D supplement', category: 'Sunlight & Vitamin D', icon: '💊', science: 'If you can\'t get adequate sun, supplementing 3,000-5,000 IU of Vitamin D3 daily has been shown to increase testosterone levels by up to 25% over 12 months.' },
  { id: 'resistance', name: 'Resistance training', category: 'Exercise & Movement', icon: '🏋️', science: 'Compound lifts (squats, deadlifts, bench) trigger acute testosterone spikes of 15-30%. Consistent resistance training elevates baseline T levels over time.' },
  { id: 'walk', name: '30min+ walk/cardio', category: 'Exercise & Movement', icon: '🚶', science: 'Moderate cardio reduces cortisol (T\'s enemy) and improves insulin sensitivity. Walking 30+ minutes daily is linked to better hormonal profiles across all ages.' },
  { id: 'zinc', name: '15g+ zinc foods/supplement', category: 'Diet & Supplements', icon: '🦪', science: 'Zinc is essential for testosterone synthesis. Deficiency can drop T levels by 75%. Top sources: oysters, red meat, pumpkin seeds, or 30mg supplement daily.' },
  { id: 'healthy-fats', name: 'Healthy fats intake', category: 'Diet & Supplements', icon: '🥑', science: 'Testosterone is literally made from cholesterol. Diets with <20% fat calories show significantly lower T. Prioritize eggs, avocado, olive oil, nuts, and fatty fish.' },
  { id: 'no-seed-oils', name: 'No seed oils/processed food', category: 'Diet & Supplements', icon: '🛡️', science: 'Seed oils (canola, soybean, sunflower) are high in omega-6, promoting inflammation and potentially disrupting hormonal balance. Whole foods support optimal T production.' },
  { id: 'mindfulness', name: '10min meditation/breathwork', category: 'Stress & Cortisol', icon: '🧘', science: 'Cortisol and testosterone have an inverse relationship. 10 minutes of meditation can reduce cortisol by 25%, creating a more favorable environment for T production.' },
  { id: 'cold', name: 'Cold shower (2+ min)', category: 'Stress & Cortisol', icon: '🧊', science: 'Cold exposure activates the sympathetic nervous system, may improve Leydig cell function, and has been linked to improved sperm quality and hormonal resilience.' },
];

const STREAK_THRESHOLD = 5;
const LEVELS = [
  { name: 'Rookie', minScore: 0, icon: '🌱' }, { name: 'Committed', minScore: 50, icon: '💪' },
  { name: 'Disciplined', minScore: 150, icon: '🔥' }, { name: 'Optimized', minScore: 400, icon: '⚡' },
  { name: 'Elite', minScore: 800, icon: '👑' }, { name: 'Legendary', minScore: 1500, icon: '🏆' },
];
const MOOD_OPTIONS = [
  { value: 1, label: 'Terrible', emoji: '😫' }, { value: 2, label: 'Bad', emoji: '😞' },
  { value: 3, label: 'Okay', emoji: '😐' }, { value: 4, label: 'Good', emoji: '🙂' },
  { value: 5, label: 'Great', emoji: '😄' }, { value: 6, label: 'Amazing', emoji: '🔥' },
];
const CATEGORIES = [...new Set(DEFAULT_HABITS.map(h => h.category))];

const PROTOCOLS = [
  { id: 'beginner', title: 'The Foundation Protocol', subtitle: '30 days to build your base', tier: 'free', level: 'Beginner', duration: '30 days', icon: '🌱', overview: 'Designed for men just starting their optimization journey. No extreme measures — just the foundational habits that make the biggest impact.', sections: [
    { title: 'Week 1-2: Sleep & Sunlight', content: 'Fix your sleep first. This alone can raise T levels 10-15%.', habits: ['15 min sunlight within 1 hour of waking', 'Consistent bedtime alarm', 'No caffeine after 2pm', 'No screens 60 min before bed'], scienceNote: 'Men who slept 5 hours had 10-15% lower T than when sleeping 8 hours (U of Chicago).' },
    { title: 'Week 2-3: Nutrition', content: 'Give your body the raw materials for testosterone production.', habits: ['3-4 whole eggs daily', 'One zinc-rich food daily', 'Replace seed oils with olive oil/butter', '0.8g protein per pound bodyweight'], scienceNote: 'Men switching from high-fat to low-fat diet saw significant T decrease (J Steroid Biochemistry).' },
    { title: 'Week 3-4: Movement & Stress', content: 'Reduce cortisol and introduce resistance training.', habits: ['30+ min walk daily', '2-3 resistance training sessions/week', '10 min breathwork daily', 'Reduce one major stressor this week'], scienceNote: 'Single resistance training sessions produce significant acute T increases.' },
    { title: 'Week 4+: Lock In', content: 'Lock in habits permanently and prepare for intermediate protocol.', habits: ['Hit 5+ habits daily', '7+ day streak', 'Log mood daily', 'Review stats every Sunday'], scienceNote: 'It takes ~66 days for a behavior to become automatic (UCL research).' }
  ], keyTakeaways: ['Sleep is #1', 'Eat real food with adequate fat', 'Morning sunlight for circadian rhythm', 'Aim for 5+ habits daily', 'Track everything'] },
  { id: 'intermediate', title: 'The Optimization Protocol', subtitle: 'Dial in for maximum output', tier: 'premium', level: 'Intermediate', duration: '60 days', icon: '⚡', overview: 'Advanced strategies — cold exposure, targeted supplementation, training periodization, and environmental optimization.', sections: [
    { title: 'Phase 1: Cold & Heat', content: 'Cold exposure activates the sympathetic nervous system.', habits: ['Build to 2+ min cold showers', '1-2 sauna sessions/week', 'Controlled breathing during cold', 'Track cold tolerance'], scienceNote: 'Cold immersion shows 200-300% increase in norepinephrine.' },
    { title: 'Phase 2: Supplements', content: 'Evidence-based supplements to fill nutritional gaps.', habits: ['Vitamin D3: 4-5k IU daily with K2', 'Zinc: 30mg daily', 'Magnesium Glycinate: 400mg before bed', 'Ashwagandha KSM-66: 600mg daily'], scienceNote: 'Ashwagandha showed 14.7% greater T increase vs placebo (Am J Men\'s Health 2019).' },
    { title: 'Phase 3: Training', content: 'Maximize hormonal response through training optimization.', habits: ['4x/week: 2 heavy, 2 moderate', 'Compound lifts priority', 'Sessions under 60 min', '8+ hours sleep on training days'], scienceNote: 'Sessions over 60 min significantly increase cortisol, blunting T response.' },
    { title: 'Phase 4: Environment', content: 'Audit your environment for endocrine disruptors.', habits: ['Glass containers instead of plastic', 'Filter drinking water', 'Face-to-face social interaction', 'Audit personal care products'], scienceNote: 'Higher BPA = significantly lower testosterone (Fertility & Sterility 2014).' }
  ], keyTakeaways: ['Cold exposure is free and powerful', 'Supplement to fill gaps', 'Train heavy, under 60 min', 'Reduce endocrine disruptors', 'Recovery is key'] },
  { id: 'advanced', title: 'The Elite Protocol', subtitle: 'Peak performance', tier: 'premium', level: 'Advanced', duration: '90 days', icon: '👑', overview: 'Advanced fasting, periodized training, blood work tracking, and mental performance optimization.', sections: [
    { title: 'Phase 1: Metabolic Flexibility', content: 'Strategic fasting for hormonal optimization.', habits: ['16:8 intermittent fasting', 'Two 24-hour fasts/month', 'Carb cycling: high on training days', 'Track fasting and energy'], scienceNote: 'IF increased growth hormone secretion by up to 2000% during fasting.' },
    { title: 'Phase 2: Periodization', content: 'Vary intensity and volume for maximum hormonal response.', habits: ['Week 1-2: Heavy (4x5 @ 85-90%)', 'Week 3: Volume (4x10-12 @ 65-75%)', 'Week 4: Deload (3x8 @ 50-60%)', '2 sprint sessions/week'], scienceNote: '6 weeks of sprint training increased T by 17% (J Strength Cond Research).' },
    { title: 'Phase 3: Blood Work', content: 'Measure to optimize with data.', habits: ['Full panel: Total T, Free T, SHBG, Estradiol, Cortisol', 'Test 7-9am fasted', 'Retest every 90 days', 'Log results with protocol notes'], scienceNote: 'T varies 30-40% through the day. Free T and SHBG tell the full story.' },
    { title: 'Phase 4: Mental Performance', content: 'The mind-body-hormone connection.', habits: ['Power posing before key interactions', 'One challenging goal per week', 'Competitive activities regularly', 'Morning: cold → sun → breathwork → visualization'], scienceNote: 'High-power poses: +20% T, -25% cortisol in 2 minutes (Harvard/Columbia).' }
  ], keyTakeaways: ['Strategic fasting boosts GH', 'Periodize training', 'Blood work every 90 days', 'Mindset affects hormones', 'Stack: Foundation → Optimization → Elite'] },
];

// ============================================================
// HELPERS
// ============================================================
const getToday = () => new Date().toISOString().split('T')[0];
function getDateStr(daysAgo) { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]; }
function calculateStreak(checkins) { let s = 0; for (let i = 0; i < 365; i++) { const dc = checkins[getDateStr(i)] || []; if (dc.length >= STREAK_THRESHOLD) s++; else if (i === 0) continue; else break; } return s; }
function calculateTotalScore(checkins) { return Object.values(checkins).reduce((s, d) => s + d.length, 0); }
function getLevel(score) { let l = LEVELS[0]; for (const lv of LEVELS) { if (score >= lv.minScore) l = lv; } return l; }
function getNextLevel(score) { for (const l of LEVELS) { if (score < l.minScore) return l; } return null; }

// ============================================================
// PALETTE
// ============================================================
const c = { bg: '#0f0d0a', bgWarm: '#141210', bgCard: '#1c1916', bgElevated: '#252119', border: '#302a21', borderLight: '#3d3529', text: '#f2ece3', textSec: '#a09383', textMuted: '#655b4e', accent: '#d4a44a', accentBright: '#e8b94a', accentDim: '#b08a3a', accentGlow: 'rgba(212,164,74,0.12)', danger: '#c45a5a', success: '#6ab06a', warning: '#d4a44a', premium: '#d4a44a', premiumGlow: 'rgba(212,164,74,0.1)' };
const sans = "-apple-system,'Helvetica Neue',sans-serif";
const serif = "'Georgia','Times New Roman',serif";

// ============================================================
// COMPONENTS
// ============================================================

function Logo({ size = 'default' }) {
  const s = { small: [16,11,6,3], default: [20,14,7,4], large: [36,28,10,6] }[size] || [20,14,7,4];
  return <div style={{ display:'flex', alignItems:'center', gap:s[2] }}><span style={{ fontSize:s[0], fontWeight:300, color:c.accent, lineHeight:1 }}>+</span><span style={{ fontSize:s[1], fontWeight:700, letterSpacing:s[3], color:c.accent, fontFamily:serif }}>ANDROS</span></div>;
}

function ScienceModal({ habit, onClose }) {
  if (!habit) return null;
  return <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:1000,padding:20 }}><div onClick={e=>e.stopPropagation()} style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:16,padding:28,maxWidth:440,width:'100%',maxHeight:'75vh',overflowY:'auto' }}><div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}><span style={{ fontSize:28 }}>{habit.icon}</span><button onClick={onClose} style={{ background:'none',border:'none',color:c.textMuted,cursor:'pointer',fontSize:18 }}>✕</button></div><h3 style={{ fontSize:18,fontWeight:700,marginBottom:16,color:c.text,fontFamily:sans }}>{habit.name}</h3><div style={{ fontSize:10,textTransform:'uppercase',letterSpacing:2,color:c.accent,fontWeight:600,marginBottom:10,fontFamily:sans }}>Why This Matters</div><p style={{ fontSize:14,lineHeight:1.75,color:c.textSec,fontFamily:sans }}>{habit.science}</p></div></div>;
}

function PremiumModal({ onClose, onUpgrade, user }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpgrade = async () => {
    setLoading(true); setError('');
    try {
      const result = await DataLayer.createCheckout(user?.id, user?.email);
      if (result.offline) { onUpgrade(); onClose(); return; }
      if (result.url) { window.location.href = result.url; }
    } catch (e) { setError(e.message || 'Something went wrong'); setLoading(false); }
  };

  return <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 }}><div onClick={e=>e.stopPropagation()} style={{ background:c.bgCard,border:`1px solid ${c.accent}40`,borderRadius:16,padding:28,maxWidth:380,width:'100%',maxHeight:'85vh',overflowY:'auto' }}>
    <div style={{ textAlign:'center',marginBottom:24 }}><div style={{ fontSize:18,color:c.accent,marginBottom:12,fontWeight:300 }}>+</div><h2 style={{ fontSize:22,fontWeight:700,marginBottom:6,color:c.text,fontFamily:serif }}>Andros Premium</h2><p style={{ color:c.textSec,fontSize:14,fontFamily:sans }}>The complete optimization toolkit</p></div>
    {[['📊','Mood Correlation Graphs'],['😴','Sleep Trend Analytics'],['📈','Detailed Breakdowns'],['🎯','Custom Habits'],['📸','Progress Photos'],['📖','Advanced Protocols']].map(([ic,t],i)=><div key={i} style={{ display:'flex',alignItems:'center',gap:12,marginBottom:14 }}><span style={{ fontSize:18 }}>{ic}</span><span style={{ fontWeight:500,fontSize:14,color:c.text,fontFamily:sans }}>{t}</span></div>)}
    <div style={{ background:c.bgElevated,borderRadius:10,padding:18,textAlign:'center',margin:'20px 0' }}><span style={{ fontSize:32,fontWeight:700,fontFamily:serif,color:c.text }}>$8.99</span><span style={{ color:c.textSec,fontSize:14,fontFamily:sans }}> /mo</span><p style={{ color:c.success,fontSize:12,marginTop:4,fontFamily:sans }}>7-day free trial · cancel anytime</p></div>
    {error && <p style={{ color:c.danger,fontSize:13,textAlign:'center',marginBottom:12,fontFamily:sans }}>{error}</p>}
    <button onClick={handleUpgrade} disabled={loading} style={{ width:'100%',padding:15,borderRadius:10,border:'none',cursor:loading?'wait':'pointer',background:c.accent,color:c.bg,fontSize:15,fontWeight:700,fontFamily:sans,opacity:loading?0.6:1 }}>{loading ? 'Redirecting to checkout...' : 'Start Free Trial'}</button>
    <p style={{ textAlign:'center',fontSize:11,color:c.textMuted,marginTop:12,fontFamily:sans }}>Secure payment via Stripe</p>
  </div></div>;
}

function HabitCard({ habit, checked, onToggle, onShowScience }) {
  return <div style={{ display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderRadius:10,border:`1px solid ${checked?c.accent+'40':c.border}`,marginBottom:6,background:checked?c.accentGlow:c.bgCard,transition:'all 0.2s ease' }}>
    <button onClick={()=>onToggle(habit.id)} style={{ width:26,height:26,borderRadius:7,border:`1.5px solid ${checked?c.accent:c.borderLight}`,background:checked?c.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,cursor:'pointer',transition:'all 0.2s ease' }}>
      {checked && <span style={{ color:c.bg,fontSize:16,fontWeight:300,lineHeight:1 }}>+</span>}
    </button>
    <div onClick={()=>onToggle(habit.id)} style={{ display:'flex',alignItems:'center',gap:10,flex:1,cursor:'pointer' }}>
      <span style={{ fontSize:16,flexShrink:0 }}>{habit.icon}</span>
      <span style={{ fontSize:14,fontWeight:500,color:c.text,textDecoration:checked?'line-through':'none',opacity:checked?0.4:1,transition:'all 0.2s ease',fontFamily:sans }}>{habit.name}</span>
    </div>
    <button onClick={()=>onShowScience(habit)} style={{ background:'none',border:'none',color:c.textMuted,cursor:'pointer',padding:4,fontSize:13,flexShrink:0 }}>ℹ</button>
  </div>;
}

function MoodTracker({ moodLog, onLogMood }) {
  const tm = moodLog[getToday()];
  return <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:20 }}>
    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}><h3 style={{ fontSize:15,fontWeight:600,color:c.text,fontFamily:sans }}>How are you feeling?</h3>{tm&&<span style={{ fontSize:11,color:c.success,fontWeight:600,fontFamily:sans }}>✓ Logged</span>}</div>
    <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8 }}>{MOOD_OPTIONS.map(m=><button key={m.value} onClick={()=>onLogMood(m.value)} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:5,padding:'12px 6px',borderRadius:8,cursor:'pointer',border:`1px solid ${tm&&tm.value===m.value?c.accent+'60':c.border}`,background:tm&&tm.value===m.value?c.accentGlow:c.bgElevated,transform:tm&&tm.value===m.value?'scale(1.04)':'scale(1)',transition:'all 0.2s ease' }}><span style={{ fontSize:22 }}>{m.emoji}</span><span style={{ fontSize:10,color:c.textSec,fontFamily:sans }}>{m.label}</span></button>)}</div>
  </div>;
}

function SleepTracker({ sleepLog, onLogSleep }) {
  const ts = sleepLog[getToday()];
  const [hours,setHours] = useState(ts?ts.hours:7);
  const h = v => { const hr=parseFloat(v); setHours(hr); onLogSleep(hr); };
  const opt = hours>=7&&hours<=9;
  return <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:20 }}>
    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}><h3 style={{ fontSize:15,fontWeight:600,color:c.text,fontFamily:sans }}>Sleep last night</h3>{ts&&<span style={{ fontSize:11,color:c.success,fontWeight:600,fontFamily:sans }}>✓ Logged</span>}</div>
    <div style={{ display:'flex',alignItems:'baseline',justifyContent:'center',gap:6,marginBottom:14 }}><span style={{ fontSize:44,fontWeight:700,fontFamily:serif,color:c.accent }}>{hours}</span><span style={{ fontSize:15,color:c.textSec,fontFamily:sans }}>hours</span></div>
    <input type="range" min="3" max="12" step="0.5" value={hours} onChange={e=>h(e.target.value)} style={{ width:'100%',accentColor:c.accent }} />
    <div style={{ display:'flex',justifyContent:'space-between',marginTop:8,fontSize:11,color:c.textMuted,fontFamily:sans }}><span>3h</span><span style={{ color:opt?c.success:c.textMuted }}>{opt?'✓ Optimal':hours<7?'Below optimal':'Above average'}</span><span>12h</span></div>
  </div>;
}

function StatsView({ checkins, moodLog, sleepLog, isPremium, onUpgrade }) {
  const last7 = Array.from({length:7},(_,i)=>{ const d=getDateStr(6-i); return { date:d, count:(checkins[d]||[]).length, mood:moodLog[d]?moodLog[d].value:null, sleep:sleepLog[d]?sleepLog[d].hours:null, day:new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'narrow'}) }; });
  const totalDays = Object.keys(checkins).length;
  const avg = totalDays>0?(Object.values(checkins).reduce((s,d)=>s+d.length,0)/totalDays).toFixed(1):'0';
  return <div>
    <h2 style={{ fontSize:20,fontWeight:400,marginBottom:20,color:c.text,fontFamily:serif }}>Your Progress</h2>
    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:18 }}>{[{v:totalDays,l:'Days Tracked'},{v:avg,l:'Avg Habits/Day'}].map((s,i)=><div key={i} style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18 }}><div style={{ fontSize:26,fontWeight:700,fontFamily:serif,color:c.text }}>{s.v}</div><div style={{ fontSize:11,color:c.textSec,textTransform:'uppercase',letterSpacing:0.5,marginTop:6,fontFamily:sans }}>{s.l}</div></div>)}</div>
    <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:18 }}>
      <h3 style={{ fontSize:14,fontWeight:600,marginBottom:14,color:c.text,fontFamily:sans }}>Last 7 Days</h3>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-end',height:110,gap:6 }}>{last7.map((d,i)=><div key={i} style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6,height:'100%' }}><div style={{ flex:1,width:'100%',background:c.bgElevated,borderRadius:4,display:'flex',alignItems:'flex-end',overflow:'hidden' }}><div style={{ width:'100%',borderRadius:4,minHeight:2,height:d.count>0?((d.count/11)*100)+'%':'2px',background:d.count>=STREAK_THRESHOLD?c.accent:c.borderLight,transition:'height 0.4s ease' }} /></div><span style={{ fontSize:10,color:c.textMuted,fontWeight:500,fontFamily:sans }}>{d.day}</span></div>)}</div>
    </div>
    {!isPremium?<div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:'28px 22px',textAlign:'center' }}><div style={{ fontSize:24,marginBottom:12,color:c.textMuted }}>🔒</div><h3 style={{ fontSize:16,fontWeight:700,marginBottom:8,color:c.text,fontFamily:sans }}>Premium Analytics</h3><p style={{ fontSize:13,color:c.textSec,lineHeight:1.5,marginBottom:22,fontFamily:sans }}>Unlock mood correlations, sleep trends, and detailed reports.</p><button onClick={onUpgrade} style={{ cursor:'pointer',background:c.bgElevated,border:`1px solid ${c.accent}50`,color:c.text,fontWeight:600,fontSize:13,padding:'12px 22px',borderRadius:10,fontFamily:sans }}>Unlock Premium — $8.99/mo</button><p style={{ fontSize:11,color:c.textMuted,marginTop:10,fontFamily:sans }}>7-day free trial</p></div>
    :<div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18 }}><h3 style={{ fontSize:14,fontWeight:600,marginBottom:14,color:c.text,fontFamily:sans }}>Mood vs Habits</h3>{last7.map((d,i)=><div key={i} style={{ display:'grid',gridTemplateColumns:'36px 1fr 28px 36px',alignItems:'center',gap:8,marginBottom:7 }}><span style={{ fontSize:11,color:c.textSec,fontFamily:sans }}>{d.day}</span><div style={{ height:7,background:c.bgElevated,borderRadius:4,overflow:'hidden' }}><div style={{ height:'100%',borderRadius:4,width:d.count>0?((d.count/11)*100)+'%':'0%',background:c.accent,transition:'width 0.4s ease' }} /></div><span style={{ fontSize:14,textAlign:'center' }}>{d.mood?MOOD_OPTIONS.find(m=>m.value===d.mood).emoji:'—'}</span><span style={{ fontSize:10,color:c.textSec,fontFamily:'monospace',textAlign:'right' }}>{d.sleep?d.sleep+'h':'—'}</span></div>)}<div style={{ display:'flex',justifyContent:'center',gap:14,marginTop:14,fontSize:11,color:c.textSec,fontFamily:sans }}><span><span style={{ color:c.accent }}>■</span> Habits</span><span>😀 Mood</span><span>💤 Sleep</span></div></div>}
  </div>;
}

function ProtocolDetail({ protocol, onBack, isPremium, onUpgrade }) {
  const locked = protocol.tier==='premium'&&!isPremium;
  const [exp,setExp] = useState(0);
  if (locked) return <div><button onClick={onBack} style={{ display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:c.textSec,cursor:'pointer',fontSize:13,marginBottom:24,padding:'8px 0',fontFamily:sans }}>← Back</button><div style={{ textAlign:'center',padding:'32px 16px' }}><div style={{ fontSize:52,marginBottom:14 }}>{protocol.icon}</div><h2 style={{ fontSize:22,fontWeight:400,marginBottom:8,color:c.text,fontFamily:serif }}>{protocol.title}</h2><p style={{ color:c.textSec,fontSize:14,marginBottom:24,fontFamily:sans }}>{protocol.overview}</p><div style={{ background:c.bgCard,border:`1px solid ${c.accent}40`,borderRadius:12,padding:28 }}><div style={{ fontSize:28,marginBottom:10,color:c.textMuted }}>🔒</div><h3 style={{ fontSize:16,fontWeight:700,marginBottom:8,color:c.text,fontFamily:sans }}>Premium Protocol</h3><button onClick={onUpgrade} style={{ cursor:'pointer',background:c.accent,border:'none',color:c.bg,fontWeight:700,fontSize:14,padding:'13px 26px',borderRadius:10,fontFamily:sans }}>Unlock — $8.99/mo</button></div></div></div>;
  return <div><button onClick={onBack} style={{ display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:c.textSec,cursor:'pointer',fontSize:13,marginBottom:24,padding:'8px 0',fontFamily:sans }}>← Back</button>
    <div style={{ textAlign:'center',marginBottom:28 }}><div style={{ fontSize:48,marginBottom:10 }}>{protocol.icon}</div><h2 style={{ fontSize:22,fontWeight:400,marginBottom:6,color:c.text,fontFamily:serif }}>{protocol.title}</h2><div style={{ display:'inline-flex',gap:8,marginTop:8 }}><span style={{ background:c.bgElevated,borderRadius:14,padding:'4px 12px',fontSize:11,color:c.textSec,fontFamily:sans }}>{protocol.level}</span><span style={{ background:c.bgElevated,borderRadius:14,padding:'4px 12px',fontSize:11,color:c.textSec,fontFamily:sans }}>{protocol.duration}</span></div></div>
    <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:16 }}><div style={{ fontSize:10,textTransform:'uppercase',letterSpacing:2,color:c.accent,fontWeight:600,marginBottom:8,fontFamily:sans }}>Overview</div><p style={{ fontSize:14,lineHeight:1.7,color:c.textSec,fontFamily:sans }}>{protocol.overview}</p></div>
    {protocol.sections.map((sec,idx)=><div key={idx} style={{ background:c.bgCard,border:`1px solid ${exp===idx?c.accent+'40':c.border}`,borderRadius:12,marginBottom:10,overflow:'hidden',transition:'border-color 0.2s' }}>
      <button onClick={()=>setExp(exp===idx?-1:idx)} style={{ width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 18px',background:'none',border:'none',cursor:'pointer',textAlign:'left' }}><div><div style={{ fontSize:10,color:c.textMuted,marginBottom:3,fontFamily:sans }}>Phase {idx+1}</div><div style={{ fontSize:14,fontWeight:600,color:c.text,fontFamily:sans }}>{sec.title}</div></div><span style={{ color:c.textMuted,fontSize:16,transform:exp===idx?'rotate(90deg)':'rotate(0)',transition:'transform 0.2s' }}>›</span></button>
      {exp===idx&&<div style={{ padding:'0 18px 18px' }}><p style={{ fontSize:13,lineHeight:1.7,color:c.textSec,marginBottom:18,fontFamily:sans }}>{sec.content}</p><div style={{ marginBottom:18 }}><div style={{ fontSize:10,textTransform:'uppercase',letterSpacing:2,color:c.accent,fontWeight:600,marginBottom:10,fontFamily:sans }}>Daily Actions</div>{sec.habits.map((h,hi)=><div key={hi} style={{ display:'flex',alignItems:'flex-start',gap:8,marginBottom:8 }}><span style={{ color:c.accent,fontSize:14,fontWeight:300,marginTop:1,flexShrink:0 }}>+</span><span style={{ fontSize:13,lineHeight:1.5,color:c.text,fontFamily:sans }}>{h}</span></div>)}</div><div style={{ background:c.bgElevated,borderRadius:8,padding:14,borderLeft:`2px solid ${c.accent}` }}><div style={{ fontSize:10,textTransform:'uppercase',letterSpacing:1,color:c.accent,fontWeight:600,marginBottom:6,fontFamily:sans }}>🔬 The Science</div><p style={{ fontSize:12,lineHeight:1.7,color:c.textSec,fontFamily:sans }}>{sec.scienceNote}</p></div></div>}
    </div>)}
    <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginTop:16 }}><div style={{ fontSize:10,textTransform:'uppercase',letterSpacing:2,color:c.accent,fontWeight:600,marginBottom:12,fontFamily:sans }}>Key Takeaways</div>{protocol.keyTakeaways.map((t,i)=><div key={i} style={{ display:'flex',alignItems:'flex-start',gap:8,marginBottom:8 }}><span style={{ color:c.accent,fontWeight:700,flexShrink:0,fontSize:13 }}>✓</span><span style={{ fontSize:13,lineHeight:1.5,color:c.text,fontFamily:sans }}>{t}</span></div>)}</div>
  </div>;
}

function ProtocolsView({ isPremium, onUpgrade, onSelect }) {
  return <div><h2 style={{ fontSize:20,fontWeight:400,marginBottom:6,color:c.text,fontFamily:serif }}>Protocols</h2><p style={{ fontSize:13,color:c.textSec,marginBottom:22,lineHeight:1.5,fontFamily:sans }}>Follow in order for best results.</p>
    {PROTOCOLS.map(pr=>{const lk=pr.tier==='premium'&&!isPremium; return <button key={pr.id} onClick={()=>onSelect(pr)} style={{ width:'100%',textAlign:'left',background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:10,cursor:'pointer',display:'flex',alignItems:'center',gap:14 }}><div style={{ width:48,height:48,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,background:c.bgElevated,border:`1px solid ${c.borderLight}`,flexShrink:0 }}>{pr.icon}</div><div style={{ flex:1 }}><div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:3 }}><span style={{ fontSize:15,fontWeight:700,color:c.text,fontFamily:sans }}>{pr.title}</span>{lk&&<span style={{ fontSize:12,color:c.accent }}>🔒</span>}</div><div style={{ fontSize:12,color:c.textMuted,fontFamily:sans }}>{pr.level} · {pr.duration}</div></div><span style={{ color:c.textMuted,fontSize:16,flexShrink:0 }}>›</span></button>;})}
    {!isPremium&&<div style={{ background:c.accentGlow,border:`1px solid ${c.accent}25`,borderRadius:12,padding:18,textAlign:'center',marginTop:8 }}><p style={{ fontSize:13,color:c.textSec,marginBottom:10,fontFamily:sans }}>Unlock all protocols with Premium</p><button onClick={onUpgrade} style={{ cursor:'pointer',background:c.accent,border:'none',color:c.bg,fontWeight:700,fontSize:13,padding:'11px 22px',borderRadius:8,fontFamily:sans }}>Start Free Trial — $8.99/mo</button></div>}
  </div>;
}

function AuthScreen({ onLogin }) {
  const [mode,setMode]=useState('welcome');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [name,setName]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(false);
  const inp = { width:'100%',background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:8,padding:'14px 16px',fontSize:15,color:c.text,outline:'none',boxSizing:'border-box',fontFamily:sans };
  const lbl = { fontSize:11,fontWeight:600,color:c.textMuted,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:6,fontFamily:sans };

  const handleSubmit = async () => {
    setError(''); setLoading(true);
    try {
      if (!email||!password) { setError('Please fill in all fields'); setLoading(false); return; }
      if (mode==='signup'&&!name) { setError('Please enter your name'); setLoading(false); return; }
      const result = mode==='login' ? await DataLayer.signIn(email,password) : await DataLayer.signUp(email,password,name);
      if (result.error) { setError(result.error); setLoading(false); return; }
      if (result.needsConfirmation) { setError('Check your email to confirm your account, then log in.'); setMode('login'); setLoading(false); return; }
      onLogin(result.user);
    } catch(e) { setError('Something went wrong. Try again.'); }
    setLoading(false);
  };

  if (mode==='welcome') return <div style={{ minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:24,background:`radial-gradient(ellipse at 50% 30%,rgba(212,164,74,0.05) 0%,transparent 55%),${c.bg}` }}><div style={{ maxWidth:380,textAlign:'center',width:'100%' }}>
    <div style={{ marginBottom:20 }}><div style={{ fontSize:32,fontWeight:300,color:c.accent,marginBottom:8 }}>+</div><h1 style={{ fontSize:36,fontWeight:700,letterSpacing:6,fontFamily:serif,color:c.accent }}>ANDROS</h1></div>
    <p style={{ fontSize:16,color:c.textSec,marginBottom:28,fontFamily:serif,fontStyle:'italic' }}>Optimize naturally.</p>
    <div style={{ width:32,height:1,background:c.accent,margin:'0 auto 28px',opacity:0.3 }} />
    <p style={{ fontSize:14,color:c.textSec,lineHeight:1.7,marginBottom:32,fontFamily:sans }}>Track science-backed habits. Follow structured protocols. Watch your energy, mood, and performance transform.</p>
    {['10+ science-backed habits','Mood & sleep tracking','Optimization protocols','Streak rewards & leveling'].map((f,i)=><div key={i} style={{ display:'flex',alignItems:'center',gap:10,fontSize:13,color:c.text,marginBottom:10,textAlign:'left',fontFamily:sans }}><span style={{ color:c.accent,fontWeight:300,fontSize:14 }}>+</span><span>{f}</span></div>)}
    <button onClick={()=>setMode('signup')} style={{ width:'100%',padding:15,borderRadius:10,border:'none',cursor:'pointer',background:c.accent,color:c.bg,fontSize:15,fontWeight:700,marginTop:28,fontFamily:sans }}>Get Started — It's Free</button>
    <button onClick={()=>setMode('login')} style={{ width:'100%',padding:14,borderRadius:10,cursor:'pointer',marginTop:10,background:'transparent',border:`1px solid ${c.border}`,color:c.text,fontSize:14,fontFamily:sans }}>I already have an account</button>
    {USE_SUPABASE&&<div style={{ marginTop:20,fontSize:11,color:c.textMuted,fontFamily:sans }}>☁ Cloud sync enabled</div>}
    {!USE_SUPABASE&&<div style={{ marginTop:20,fontSize:11,color:c.textMuted,fontFamily:sans }}>📱 Offline mode — data saved locally</div>}
  </div></div>;

  return <div style={{ minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:24,background:c.bg }}><div style={{ maxWidth:380,width:'100%' }}>
    <button onClick={()=>setMode('welcome')} style={{ display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:c.textSec,fontSize:13,cursor:'pointer',marginBottom:32,padding:'8px 0',fontFamily:sans }}>← Back</button>
    <Logo /><h2 style={{ fontSize:24,fontWeight:400,marginBottom:6,marginTop:20,color:c.text,fontFamily:serif }}>{mode==='login'?'Welcome back':'Create your account'}</h2><p style={{ color:c.textSec,fontSize:14,marginBottom:26,fontFamily:sans }}>{mode==='login'?'Log in to continue your streak':'Start optimizing today'}</p>
    <div style={{ display:'flex',flexDirection:'column',gap:16 }}>
      {mode==='signup'&&<div><label style={lbl}>Name</label><input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={inp} /></div>}
      <div><label style={lbl}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inp} /></div>
      <div><label style={lbl}>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={inp} /></div>
      {error&&<p style={{ color:c.danger,fontSize:13,fontFamily:sans }}>{error}</p>}
      <button onClick={handleSubmit} disabled={loading} style={{ width:'100%',padding:15,borderRadius:10,border:'none',cursor:loading?'wait':'pointer',background:c.accent,color:c.bg,fontSize:15,fontWeight:700,marginTop:4,fontFamily:sans,opacity:loading?0.6:1 }}>{loading?'Please wait...':mode==='login'?'Log In':'Create Account'}</button>
    </div>
    <p style={{ textAlign:'center',marginTop:22,fontSize:13,color:c.textSec,fontFamily:sans }}>{mode==='login'?"Don't have an account? ":'Already have an account? '}<button onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');}} style={{ background:'none',border:'none',color:c.accent,cursor:'pointer',fontSize:13,fontWeight:600,textDecoration:'underline',fontFamily:sans }}>{mode==='login'?'Sign up':'Log in'}</button></p>
  </div></div>;
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [user,setUser]=useState(null);const [isPremium,setIsPremium]=useState(false);const [tab,setTab]=useState('today');
  const [checkins,setCheckins]=useState({});const [moodLog,setMoodLog]=useState({});const [sleepLog,setSleepLog]=useState({});
  const [scienceHabit,setScienceHabit]=useState(null);const [showPremium,setShowPremium]=useState(false);const [selectedProtocol,setSelectedProtocol]=useState(null);
  const [loading,setLoading]=useState(true);const [checkoutMessage,setCheckoutMessage]=useState('');

  // Restore session on mount
  useEffect(() => { (async()=>{ try { const u = await DataLayer.restoreSession(); if(u) { setUser(u); const [ch,mo,sl,pr] = await Promise.all([DataLayer.getCheckins(u.id),DataLayer.getMoodLogs(u.id),DataLayer.getSleepLogs(u.id),DataLayer.getPremiumStatus(u.id)]); setCheckins(ch);setMoodLog(mo);setSleepLog(sl);setIsPremium(pr); } } catch(e){} setLoading(false); })(); }, []);

  // Handle Stripe checkout return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setCheckoutMessage('Welcome to Premium! Your 7-day free trial has started.');
      // Refresh premium status after a short delay (webhook may take a moment)
      setTimeout(async () => {
        if (user?.id) {
          const pr = await DataLayer.getPremiumStatus(user.id);
          setIsPremium(pr);
        }
      }, 2000);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('checkout') === 'cancel') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user]);

  const handleLogin = async (u) => {
    setUser(u);
    try { const [ch,mo,sl,pr] = await Promise.all([DataLayer.getCheckins(u.id),DataLayer.getMoodLogs(u.id),DataLayer.getSleepLogs(u.id),DataLayer.getPremiumStatus(u.id)]); setCheckins(ch);setMoodLog(mo);setSleepLog(sl);setIsPremium(pr); } catch(e){}
  };

  const handleLogout = async () => { await DataLayer.signOut(); setUser(null); setCheckins({}); setMoodLog({}); setSleepLog({}); setIsPremium(false); };

  const toggleHabit = async (habitId) => {
    const todayStr = getToday(); const dc = checkins[todayStr]||[]; const checked = dc.includes(habitId);
    const updated = checked ? dc.filter(id=>id!==habitId) : [...dc,habitId];
    setCheckins(prev=>({...prev,[todayStr]:updated}));
    await DataLayer.toggleCheckin(user.id,habitId,todayStr,checked);
  };

  const logMood = async (value) => {
    const todayStr = getToday();
    setMoodLog(prev=>({...prev,[todayStr]:{value,time:new Date().toISOString()}}));
    await DataLayer.logMood(user.id,todayStr,value);
  };

  const logSleep = async (hours) => {
    const todayStr = getToday();
    setSleepLog(prev=>({...prev,[todayStr]:{hours,time:new Date().toISOString()}}));
    await DataLayer.logSleep(user.id,todayStr,hours);
  };

  const handleUpgrade = async () => {
    setIsPremium(true);
    await DataLayer.setPremium(user.id,true);
  };

  if (loading) return <div style={{ minHeight:'100vh',background:c.bg,display:'flex',alignItems:'center',justifyContent:'center' }}><div style={{ textAlign:'center' }}><div style={{ fontSize:24,fontWeight:300,color:c.accent,marginBottom:8 }}>+</div><div style={{ fontSize:14,color:c.textMuted,fontFamily:sans }}>Loading...</div></div></div>;
  if (!user) return <AuthScreen onLogin={handleLogin} />;

  const todayStr=getToday();const todayCheckins=checkins[todayStr]||[];const streak=calculateStreak(checkins);const totalScore=calculateTotalScore(checkins);const level=getLevel(totalScore);const nextLevel=getNextLevel(totalScore);const streakMaintained=todayCheckins.length>=STREAK_THRESHOLD;

  return <div style={{ minHeight:'100vh',background:c.bg,color:c.text,fontFamily:sans }}>
    <header style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',borderBottom:`1px solid ${c.border}`,background:'rgba(15,13,10,0.95)',position:'sticky',top:0,zIndex:100 }}>
      <Logo size="small" />
      <div style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:16,border:`1px solid ${streak>0?c.accent+'50':c.border}`,background:streak>0?c.accentGlow:c.bgElevated,fontSize:13,fontWeight:600 }}>
        <span style={{ fontSize:14 }}>🔥</span><span style={{ fontFamily:'monospace',fontWeight:700,color:streak>0?c.accent:c.textMuted }}>{streak}</span>
      </div>
    </header>
    {checkoutMessage && <div style={{ background:c.accentGlow,borderBottom:`1px solid ${c.accent}40`,padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center' }}><span style={{ fontSize:13,color:c.accent,fontWeight:600,fontFamily:sans }}>{checkoutMessage}</span><button onClick={()=>setCheckoutMessage('')} style={{ background:'none',border:'none',color:c.accent,cursor:'pointer',fontSize:16 }}>✕</button></div>}
    <main style={{ maxWidth:480,margin:'0 auto',padding:'18px 20px',paddingBottom:90 }}>
      {tab==='today'&&<div>
        <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:16,marginBottom:16 }}>
          <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:10 }}><span style={{ fontSize:18 }}>{level.icon}</span><span style={{ fontWeight:600,fontSize:14 }}>{level.name}</span><span style={{ marginLeft:'auto',fontFamily:'monospace',fontSize:12,color:c.textSec }}>{totalScore} pts</span></div>
          {nextLevel&&<div><div style={{ height:5,background:c.bgElevated,borderRadius:3,overflow:'hidden' }}><div style={{ height:'100%',borderRadius:3,transition:'width 0.5s',background:`linear-gradient(90deg,${c.accent},${c.accentDim})`,width:((totalScore-level.minScore)/(nextLevel.minScore-level.minScore)*100)+'%' }} /></div><div style={{ fontSize:11,color:c.textMuted,marginTop:7,textAlign:'right' }}>{nextLevel.icon} {nextLevel.name} at {nextLevel.minScore} pts</div></div>}
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:14,marginBottom:22,padding:16,background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12 }}>
          <div style={{ display:'flex',alignItems:'baseline',gap:2 }}><span style={{ fontSize:34,fontWeight:700,fontFamily:serif,color:c.accent }}>{todayCheckins.length}</span><span style={{ fontSize:15,color:c.textMuted,fontFamily:'monospace' }}>/ {DEFAULT_HABITS.length}</span></div>
          <div style={{ display:'flex',flexDirection:'column',gap:3 }}><span style={{ fontSize:13,color:c.textSec }}>habits today</span>{!streakMaintained?<span style={{ fontSize:11,color:c.warning,fontWeight:500 }}>Need {STREAK_THRESHOLD-todayCheckins.length} more for streak</span>:<span style={{ fontSize:11,color:c.success,fontWeight:600 }}>✓ Streak maintained</span>}</div>
        </div>
        {CATEGORIES.map(cat=><div key={cat} style={{ marginBottom:18 }}><h3 style={{ fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:2,color:c.textMuted,marginBottom:8,paddingLeft:2 }}>{cat}</h3>{DEFAULT_HABITS.filter(h=>h.category===cat).map(habit=><HabitCard key={habit.id} habit={habit} checked={todayCheckins.includes(habit.id)} onToggle={toggleHabit} onShowScience={setScienceHabit} />)}</div>)}
        <div style={{ marginTop:22 }}><MoodTracker moodLog={moodLog} onLogMood={logMood} /></div>
        <div style={{ marginTop:12 }}><SleepTracker sleepLog={sleepLog} onLogSleep={logSleep} /></div>
      </div>}
      {tab==='protocols'&&(selectedProtocol?<ProtocolDetail protocol={selectedProtocol} onBack={()=>setSelectedProtocol(null)} isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} />:<ProtocolsView isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} onSelect={setSelectedProtocol} />)}
      {tab==='stats'&&<StatsView checkins={checkins} moodLog={moodLog} sleepLog={sleepLog} isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} />}
      {tab==='profile'&&<div style={{ paddingTop:20,textAlign:'center' }}>
        <div style={{ width:68,height:68,borderRadius:'50%',margin:'0 auto 14px',background:`linear-gradient(135deg,${c.accent},${c.accentDim})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,fontWeight:700,color:c.bg,fontFamily:serif }}>{user.name?user.name[0].toUpperCase():'?'}</div>
        <h2 style={{ fontSize:20,fontWeight:400,marginBottom:4,fontFamily:serif }}>{user.name}</h2>
        <p style={{ fontSize:13,color:c.textSec,marginBottom:14 }}>{user.email}</p>
        {isPremium&&<div style={{ display:'inline-flex',alignItems:'center',gap:6,background:c.premiumGlow,border:`1px solid ${c.accent}40`,borderRadius:16,padding:'5px 14px',fontSize:12,fontWeight:600,color:c.accent,marginBottom:20 }}>+ Premium</div>}
        {!isPremium&&<button onClick={()=>setShowPremium(true)} style={{ display:'block',width:'100%',padding:13,borderRadius:10,cursor:'pointer',border:`1px solid ${c.accent}40`,background:c.accentGlow,color:c.accent,fontSize:14,fontWeight:600,marginBottom:12,fontFamily:sans }}>Upgrade to Premium</button>}
        <div style={{ fontSize:11,color:c.textMuted,marginTop:8,marginBottom:16 }}>{USE_SUPABASE?'☁ Cloud sync active':'📱 Offline mode'}</div>
        <button onClick={handleLogout} style={{ width:'100%',padding:13,borderRadius:10,cursor:'pointer',border:`1px solid ${c.border}`,background:'none',color:c.danger,fontSize:14,fontWeight:500,fontFamily:sans }}>Log Out</button>
      </div>}
    </main>
    <nav style={{ position:'fixed',bottom:0,left:0,right:0,display:'flex',justifyContent:'space-around',background:'rgba(15,13,10,0.95)',borderTop:`1px solid ${c.border}`,padding:'9px 0 13px',zIndex:100 }}>
      {[{id:'today',label:'Today',icon:'+'},{id:'protocols',label:'Learn',icon:'📖'},{id:'stats',label:'Stats',icon:'📊'},{id:'profile',label:'Profile',icon:'👤'}].map(t=><button key={t.id} onClick={()=>{setTab(t.id);if(t.id!=='protocols')setSelectedProtocol(null);}} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'5px 16px',background:'none',border:'none',cursor:'pointer',color:tab===t.id?c.accent:c.textMuted,transition:'color 0.2s' }}><span style={{ fontSize:t.icon==='+'?22:18,fontWeight:t.icon==='+'?300:400 }}>{t.icon}</span><span style={{ fontSize:10,fontWeight:500 }}>{t.label}</span></button>)}
    </nav>
    {scienceHabit&&<ScienceModal habit={scienceHabit} onClose={()=>setScienceHabit(null)} />}
    {showPremium&&<PremiumModal onClose={()=>setShowPremium(false)} onUpgrade={handleUpgrade} user={user} />}
  </div>;
}
