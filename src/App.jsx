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
      // Supabase returns a user with no access_token and fake/empty identities when email already exists
      if (!data.access_token && data.user && (!data.user.identities || data.user.identities.length === 0)) {
        return { error: 'An account with this email already exists. Try logging in instead.' };
      }
      if (data.access_token) {
        LocalStore.set('sb_token', data.access_token);
        return { user: { id: data.user?.id, email, name } };
      }
      // Email confirmation might be required
      if (data.user?.id) {
        return { user: { id: data.user.id, email, name }, needsConfirmation: true };
      }
      return { error: 'An account with this email already exists. Try logging in instead.' };
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

// ============================================================
// TESTOSTERONE SCORE ENGINE
// ============================================================
const SCORE_CATEGORIES = {
  sleep: { habits: ['sleep', 'no-alcohol'], maxPoints: 30, label: 'Sleep & Recovery', icon: '🌙', type: 'streak' },
  training: { habits: ['resistance', 'walk'], maxPoints: 25, label: 'Training', icon: '🏋️', type: 'rolling7' },
  nutrition: { habits: ['zinc', 'healthy-fats', 'no-seed-oils', 'vitamin-d'], maxPoints: 25, label: 'Nutrition', icon: '🥑', type: 'rolling3' },
  lifestyle: { habits: ['sunlight', 'mindfulness', 'cold'], maxPoints: 20, label: 'Lifestyle', icon: '⚡', type: 'rolling7' },
};

function calculateTScore(checkins, sleepLog) {
  const today = getToday();
  const todayHabits = checkins[today] || [];

  // --- Sleep component (30 pts) - streak based, hard reset ---
  let sleepStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = getDateStr(i);
    const dayHabits = checkins[d] || [];
    const hasSleep = SCORE_CATEGORIES.sleep.habits.some(h => dayHabits.includes(h));
    if (hasSleep) sleepStreak++;
    else if (i === 0) continue; // today might not be logged yet
    else break;
  }
  const sleepMult = 1 - Math.exp(-sleepStreak / 4);
  const todaySleepHabits = SCORE_CATEGORIES.sleep.habits.filter(h => todayHabits.includes(h));
  const todaySleepRatio = todaySleepHabits.length / SCORE_CATEGORIES.sleep.habits.length;
  const sleepScore = SCORE_CATEGORIES.sleep.maxPoints * todaySleepRatio * (0.5 + 0.5 * sleepMult);

  // --- Training component (25 pts) - rolling 7-day ---
  let trainingDays = 0;
  const daysToCheck = Math.min(7, Object.keys(checkins).length || 1);
  for (let i = 0; i < daysToCheck; i++) {
    const d = getDateStr(i);
    const dayHabits = checkins[d] || [];
    if (SCORE_CATEGORIES.training.habits.some(h => dayHabits.includes(h))) trainingDays++;
  }
  const trainingMult = Math.min(trainingDays / 3, 1);
  const trainingScore = SCORE_CATEGORIES.training.maxPoints * trainingMult;

  // --- Nutrition component (25 pts) - rolling 3-day avg ---
  let nutritionTotal = 0;
  const nutriDays = Math.min(3, Object.keys(checkins).length || 1);
  for (let i = 0; i < nutriDays; i++) {
    const d = getDateStr(i);
    const dayHabits = checkins[d] || [];
    const hit = SCORE_CATEGORIES.nutrition.habits.filter(h => dayHabits.includes(h)).length;
    nutritionTotal += hit / SCORE_CATEGORIES.nutrition.habits.length;
  }
  const nutritionMult = nutritionTotal / nutriDays;
  const nutritionScore = SCORE_CATEGORIES.nutrition.maxPoints * nutritionMult;

  // --- Lifestyle component (20 pts) - rolling 7-day avg ---
  let lifestyleTotal = 0;
  const lifeDays = Math.min(7, Object.keys(checkins).length || 1);
  for (let i = 0; i < lifeDays; i++) {
    const d = getDateStr(i);
    const dayHabits = checkins[d] || [];
    const hit = SCORE_CATEGORIES.lifestyle.habits.filter(h => dayHabits.includes(h)).length;
    lifestyleTotal += hit / SCORE_CATEGORIES.lifestyle.habits.length;
  }
  const lifestyleMult = lifestyleTotal / lifeDays;
  const lifestyleScore = SCORE_CATEGORIES.lifestyle.maxPoints * lifestyleMult;

  // --- Consistency bonus (30 days to max) ---
  const overallStreak = calculateStreak(checkins);
  const consistencyMult = 1 - Math.exp(-overallStreak / 8);

  // --- Final score ---
  const rawScore = sleepScore + trainingScore + nutritionScore + lifestyleScore;
  const finalScore = Math.round(rawScore * (0.8 + 0.2 * consistencyMult));

  return {
    total: Math.min(finalScore, 100),
    breakdown: {
      sleep: { score: Math.round(sleepScore), max: 30, streak: sleepStreak, mult: sleepMult },
      training: { score: Math.round(trainingScore), max: 25, days: trainingDays, mult: trainingMult },
      nutrition: { score: Math.round(nutritionScore), max: 25, mult: nutritionMult },
      lifestyle: { score: Math.round(lifestyleScore), max: 20, mult: lifestyleMult },
    },
    consistency: { streak: overallStreak, mult: consistencyMult },
    rawScore: Math.round(rawScore),
  };
}

function getScoreLabel(score) {
  if (score >= 95) return { label: 'Optimal', color: '#d4a44a' };
  if (score >= 85) return { label: 'Excellent', color: '#6ab06a' };
  if (score >= 70) return { label: 'Good', color: '#6ab06a' };
  if (score >= 50) return { label: 'Moderate', color: '#d4a44a' };
  if (score >= 30) return { label: 'Low', color: '#c47a3a' };
  return { label: 'Critical', color: '#c45a5a' };
}

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

const LOW_T_SYMPTOMS = [
  { id: 'tired', label: 'Tired/Fatigued', icon: '💤' },
  { id: 'brainfog', label: 'Brain Fog', icon: '🌫' },
  { id: 'irritable', label: 'Irritable', icon: '😤' },
  { id: 'lowlibido', label: 'Low Libido', icon: '📉' },
  { id: 'anxious', label: 'Anxious', icon: '😰' },
  { id: 'motivated', label: 'Motivated', icon: '⚡' },
  { id: 'confident', label: 'Confident', icon: '💪' },
  { id: 'focused', label: 'Focused', icon: '🎯' },
];

function MoodTracker({ moodLog, onLogMood }) {
  const tm = moodLog[getToday()];
  const [selectedSymptoms, setSelectedSymptoms] = useState(tm?.symptoms || []);
  const [note, setNote] = useState(tm?.note || '');
  const [expanded, setExpanded] = useState(!tm);

  const toggleSymptom = (id) => {
    setSelectedSymptoms(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleMoodSelect = (value) => {
    onLogMood(value, selectedSymptoms, note);
  };

  return <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:20 }}>
    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
      <h3 style={{ fontSize:15,fontWeight:600,color:c.text,fontFamily:sans }}>Daily Check-in</h3>
      {tm&&<span style={{ fontSize:11,color:c.success,fontWeight:600,fontFamily:sans }}>+ Logged</span>}
    </div>
    <p style={{ fontSize:12,color:c.textMuted,marginBottom:16,fontFamily:sans }}>Track how you feel to spot patterns over time</p>

    <div style={{ fontSize:12,fontWeight:600,color:c.textSec,marginBottom:10,fontFamily:sans,textTransform:'uppercase',letterSpacing:1 }}>Mood</div>
    <div style={{ display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:6,marginBottom:20 }}>{MOOD_OPTIONS.map(m=><button key={m.value} onClick={()=>handleMoodSelect(m.value)} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'10px 2px',borderRadius:8,cursor:'pointer',border:`1px solid ${tm&&tm.value===m.value?c.accent+'60':c.border}`,background:tm&&tm.value===m.value?c.accentGlow:c.bgElevated,transform:tm&&tm.value===m.value?'scale(1.06)':'scale(1)',transition:'all 0.2s ease' }}><span style={{ fontSize:20 }}>{m.emoji}</span><span style={{ fontSize:9,color:tm&&tm.value===m.value?c.accent:c.textSec,fontFamily:sans }}>{m.label}</span></button>)}</div>

    <button onClick={()=>setExpanded(!expanded)} style={{ width:'100%',background:'none',border:'none',cursor:'pointer',color:c.textMuted,fontSize:11,fontFamily:sans,padding:'6px 0',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
      <span>{expanded?'Hide':'Show'} symptoms & notes</span><span style={{ fontSize:8,transform:expanded?'rotate(180deg)':'rotate(0)',transition:'transform 0.2s' }}>▼</span>
    </button>

    {expanded&&<div style={{ marginTop:12 }}>
      <div style={{ fontSize:12,fontWeight:600,color:c.textSec,marginBottom:10,fontFamily:sans,textTransform:'uppercase',letterSpacing:1 }}>How are you feeling?</div>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:6,marginBottom:18 }}>{LOW_T_SYMPTOMS.map(s=><button key={s.id} onClick={()=>toggleSymptom(s.id)} style={{ display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderRadius:8,cursor:'pointer',border:`1px solid ${selectedSymptoms.includes(s.id)?c.accent+'60':c.border}`,background:selectedSymptoms.includes(s.id)?c.accentGlow:c.bgElevated,transition:'all 0.2s ease',textAlign:'left' }}><span style={{ fontSize:14 }}>{s.icon}</span><span style={{ fontSize:12,color:selectedSymptoms.includes(s.id)?c.accent:c.textSec,fontFamily:sans,fontWeight:selectedSymptoms.includes(s.id)?600:400 }}>{s.label}</span></button>)}</div>

      <div style={{ fontSize:12,fontWeight:600,color:c.textSec,marginBottom:10,fontFamily:sans,textTransform:'uppercase',letterSpacing:1 }}>Notes</div>
      <textarea value={note} onChange={e=>setNote(e.target.value)} onBlur={()=>{if(tm)onLogMood(tm.value,selectedSymptoms,note);}} placeholder="Anything else? (workout, diet, stress, etc.)" style={{ width:'100%',minHeight:70,padding:12,borderRadius:8,border:`1px solid ${c.border}`,background:c.bgElevated,color:c.text,fontSize:13,fontFamily:sans,resize:'vertical',outline:'none' }} />
    </div>}
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

const BADGES = [
  { id: 'first', name: 'First Step', desc: 'Complete your first day', icon: '🌱', check: (ck) => Object.keys(ck).length >= 1 },
  { id: 'streak3', name: '3-Day Streak', desc: 'Maintain streak for 3 days', icon: '🔥', check: (ck, str) => str >= 3 },
  { id: 'streak7', name: 'One Week Strong', desc: '7-day streak', icon: '💪', check: (ck, str) => str >= 7 },
  { id: 'streak14', name: 'Two Week Warrior', desc: '14-day streak', icon: '⚔️', check: (ck, str) => str >= 14 },
  { id: 'streak30', name: 'Monthly Master', desc: '30-day streak', icon: '🏆', check: (ck, str) => str >= 30 },
  { id: 'streak60', name: 'Habit Forged', desc: '60-day streak (habit is automatic)', icon: '⚡', check: (ck, str) => str >= 60 },
  { id: 'streak100', name: 'Century Club', desc: '100-day streak', icon: '💯', check: (ck, str) => str >= 100 },
  { id: 'perfect', name: 'Perfect Day', desc: 'Complete all 11 habits in one day', icon: '✨', check: (ck) => Object.values(ck).some(d => d.length >= 11) },
  { id: 'week5', name: 'Consistent', desc: '5+ habits every day for a week', icon: '📈', check: (ck) => { for(let i=0;i<7;i++){const d=ck[getDateStr(i)]||[];if(d.length<5)return false;} return Object.keys(ck).length>=7; } },
  { id: 'total100', name: 'Centurion', desc: 'Log 100 total habit completions', icon: '🎯', check: (ck) => Object.values(ck).reduce((s,d)=>s+d.length,0) >= 100 },
  { id: 'total500', name: 'Relentless', desc: '500 total habit completions', icon: '👑', check: (ck) => Object.values(ck).reduce((s,d)=>s+d.length,0) >= 500 },
  { id: 'total1000', name: 'Legendary', desc: '1000 total completions', icon: '🏅', check: (ck) => Object.values(ck).reduce((s,d)=>s+d.length,0) >= 1000 },
];

function StatsView({ checkins, moodLog, sleepLog, isPremium, onUpgrade }) {
  const last7 = Array.from({length:7},(_,i)=>{ const d=getDateStr(6-i); return { date:d, count:(checkins[d]||[]).length, mood:moodLog[d]?moodLog[d].value:null, sleep:sleepLog[d]?sleepLog[d].hours:null, day:new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'narrow'}) }; });
  const totalDays = Object.keys(checkins).length;
  const totalHabits = Object.values(checkins).reduce((s,d)=>s+d.length,0);
  const avg = totalDays>0?(totalHabits/totalDays).toFixed(1):'0';
  const streak = calculateStreak(checkins);
  const level = getLevel(totalHabits);
  const nextLevel = getNextLevel(totalHabits);
  const progress = nextLevel ? ((totalHabits - level.minScore) / (nextLevel.minScore - level.minScore)) * 100 : 100;
  const earnedBadges = BADGES.filter(b => b.check(checkins, streak));
  const lockedBadges = BADGES.filter(b => !b.check(checkins, streak));
  const bestDay = Object.entries(checkins).reduce((best, [d, arr]) => arr.length > (best.count||0) ? { date: d, count: arr.length } : best, { count: 0 });

  return <div>
    <h2 style={{ fontSize:20,fontWeight:400,marginBottom:20,color:c.text,fontFamily:serif }}>Your Progress</h2>

    {/* Streak - Big and prominent */}
    <div style={{ background:c.bgCard,border:`1px solid ${streak>=3?c.accent+'40':c.border}`,borderRadius:16,padding:24,marginBottom:14,textAlign:'center' }}>
      <div style={{ fontSize:52,fontWeight:700,fontFamily:serif,color:streak>0?c.accent:c.textMuted,lineHeight:1 }}>{streak}</div>
      <div style={{ fontSize:13,color:c.textSec,marginTop:6,fontFamily:sans,fontWeight:500 }}>day streak {streak>0?'🔥':''}</div>
      {streak>=7&&<div style={{ marginTop:10,fontSize:11,color:c.accent,fontWeight:600,fontFamily:sans }}>{streak>=30?'Unstoppable.':streak>=14?'Building real momentum.':'Keep it going!'}</div>}
    </div>

    {/* Level progress */}
    <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:14 }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10 }}>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <span style={{ fontSize:20 }}>{level.icon}</span>
          <div><div style={{ fontSize:14,fontWeight:700,color:c.text,fontFamily:sans }}>{level.name}</div><div style={{ fontSize:11,color:c.textMuted,fontFamily:sans }}>{totalHabits} total habits logged</div></div>
        </div>
        {nextLevel&&<div style={{ textAlign:'right' }}><div style={{ fontSize:11,color:c.textMuted,fontFamily:sans }}>Next: {nextLevel.name}</div><div style={{ fontSize:11,color:c.accent,fontFamily:sans }}>{nextLevel.minScore - totalHabits} to go</div></div>}
      </div>
      <div style={{ height:6,background:c.bgElevated,borderRadius:3,overflow:'hidden' }}><div style={{ height:'100%',borderRadius:3,width:Math.min(progress,100)+'%',background:`linear-gradient(90deg,${c.accent},${c.accentBright})`,transition:'width 0.4s ease' }}/></div>
    </div>

    {/* Quick stats */}
    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:14 }}>
      {[{v:totalDays,l:'Days'},{v:avg,l:'Avg/Day'},{v:bestDay.count,l:'Best Day'}].map((s,i)=><div key={i} style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:14,textAlign:'center' }}><div style={{ fontSize:22,fontWeight:700,fontFamily:serif,color:c.text }}>{s.v}</div><div style={{ fontSize:10,color:c.textSec,textTransform:'uppercase',letterSpacing:0.5,marginTop:4,fontFamily:sans }}>{s.l}</div></div>)}
    </div>

    {/* Last 7 days chart */}
    <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:14 }}>
      <h3 style={{ fontSize:14,fontWeight:600,marginBottom:14,color:c.text,fontFamily:sans }}>Last 7 Days</h3>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-end',height:110,gap:6 }}>{last7.map((d,i)=><div key={i} style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6,height:'100%' }}><div style={{ flex:1,width:'100%',background:c.bgElevated,borderRadius:4,display:'flex',alignItems:'flex-end',overflow:'hidden' }}><div style={{ width:'100%',borderRadius:4,minHeight:2,height:d.count>0?((d.count/11)*100)+'%':'2px',background:d.count>=STREAK_THRESHOLD?c.accent:c.borderLight,transition:'height 0.4s ease' }} /></div><span style={{ fontSize:10,color:c.textMuted,fontWeight:500,fontFamily:sans }}>{d.day}</span></div>)}</div>
    </div>

    {/* Badges */}
    <div style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:14 }}>
      <h3 style={{ fontSize:14,fontWeight:600,marginBottom:4,color:c.text,fontFamily:sans }}>Badges</h3>
      <p style={{ fontSize:11,color:c.textMuted,marginBottom:14,fontFamily:sans }}>{earnedBadges.length} of {BADGES.length} earned</p>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8 }}>
        {earnedBadges.map(b=><div key={b.id} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:10,borderRadius:10,background:c.accentGlow,border:`1px solid ${c.accent}30` }}>
          <span style={{ fontSize:24 }}>{b.icon}</span>
          <span style={{ fontSize:9,color:c.accent,fontFamily:sans,textAlign:'center',fontWeight:600,lineHeight:1.2 }}>{b.name}</span>
        </div>)}
        {lockedBadges.slice(0,Math.max(0,8-earnedBadges.length)).map(b=><div key={b.id} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:10,borderRadius:10,background:c.bgElevated,border:`1px solid ${c.border}`,opacity:0.4 }}>
          <span style={{ fontSize:24,filter:'grayscale(1)' }}>{b.icon}</span>
          <span style={{ fontSize:9,color:c.textMuted,fontFamily:sans,textAlign:'center',lineHeight:1.2 }}>{b.name}</span>
        </div>)}
      </div>
    </div>

    {/* Premium analytics or upsell */}
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

const T_EDUCATION = [
  { id: 'what', title: 'What Is Testosterone?', content: 'Testosterone is the primary male sex hormone and anabolic steroid. It plays a key role in muscle mass, bone density, body hair, red blood cell production, mood regulation, and sex drive. Women also produce testosterone in smaller amounts. It\'s made primarily in the Leydig cells of the testes, with small amounts from the adrenal glands.', icon: '🧬' },
  { id: 'how', title: 'How Your Body Makes It', content: 'It starts in the brain. Your hypothalamus releases GnRH (gonadotropin-releasing hormone), which signals the pituitary gland to release LH (luteinizing hormone) and FSH. LH travels to the testes and tells the Leydig cells to convert cholesterol into testosterone. This is why dietary fat, sleep, and stress management are critical — they directly affect this signaling chain. Cholesterol → pregnenolone → DHEA → androstenedione → testosterone.', icon: '⚙️' },
  { id: 'does', title: 'What Testosterone Does', content: 'Builds and maintains muscle mass and strength. Regulates fat distribution (less belly fat at healthy levels). Drives libido and sexual function. Supports bone mineral density. Produces red blood cells (energy, endurance). Influences mood, confidence, motivation, and cognitive sharpness. Supports sperm production and fertility.', icon: '⚡' },
  { id: 'doesnt', title: 'What It Doesn\'t Do', content: 'Testosterone alone doesn\'t make you aggressive — that\'s largely a myth. It doesn\'t guarantee muscle growth without exercise. It\'s not a personality trait. Having high T doesn\'t automatically mean better health if other markers are off. And it\'s only one piece of the hormonal puzzle — cortisol, estrogen, SHBG, thyroid hormones, and insulin all interact with testosterone.', icon: '🚫' },
  { id: 'low', title: 'Signs of Low Testosterone', content: 'Persistent fatigue even with adequate sleep. Reduced sex drive or erectile difficulty. Loss of muscle mass or difficulty building muscle. Increased body fat, especially around the midsection. Brain fog, poor concentration, memory issues. Mood changes — irritability, low motivation, depression. Decreased bone density. Sleep disturbances. Reduced facial and body hair growth over time.', icon: '📉' },
  { id: 'high', title: 'Too Much Testosterone', content: 'Excess testosterone (usually from external sources) can convert to estrogen via aromatase, causing gynecomastia. It can increase red blood cell count to dangerous levels (polycythemia). Other risks include acne, hair loss, mood swings, aggression, sleep apnea, reduced sperm count, and testicular shrinkage. This is why Andros focuses on natural optimization — your body has feedback loops that prevent overproduction.', icon: '📈' },
];

const SOURCES = [
  { title: 'Sleep restriction and testosterone', source: 'Leproult & Van Cauter, JAMA 2011', url: 'https://pubmed.ncbi.nlm.nih.gov/21632481/' },
  { title: 'Resistance training and testosterone response', source: 'Kraemer & Ratamess, Sports Medicine 2005', url: 'https://pubmed.ncbi.nlm.nih.gov/15831061/' },
  { title: 'Vitamin D supplementation and testosterone', source: 'Pilz et al., Hormone & Metabolic Research 2011', url: 'https://pubmed.ncbi.nlm.nih.gov/21154195/' },
  { title: 'Ashwagandha and male reproductive health', source: 'Chauhan et al., Am J Men\'s Health 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36655469/' },
  { title: 'Diet composition and testosterone', source: 'Whittaker & Harris, J Steroid Biochem Mol Biol 2022', url: 'https://pubmed.ncbi.nlm.nih.gov/35015858/' },
  { title: 'Cold exposure and catecholamines', source: 'Srámek et al., European J Applied Physiology 2000', url: 'https://pubmed.ncbi.nlm.nih.gov/10751106/' },
  { title: 'BPA exposure and male hormones', source: 'Meeker et al., Fertility & Sterility 2010', url: 'https://pubmed.ncbi.nlm.nih.gov/19328465/' },
  { title: 'Sprint training and testosterone', source: 'Hackney et al., J Strength Cond Research 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22228111/' },
  { title: 'Intermittent fasting and growth hormone', source: 'Ho et al., J Clinical Investigation 1988', url: 'https://pubmed.ncbi.nlm.nih.gov/3127426/' },
  { title: 'Habit formation timeline (66 days)', source: 'Lally et al., European J Social Psychology 2010', url: 'https://pubmed.ncbi.nlm.nih.gov/20674467/' },
];

function ProtocolsView({ isPremium, onUpgrade, onSelect }) {
  const [learnTab, setLearnTab] = useState('protocols');
  const [expandedEdu, setExpandedEdu] = useState(null);

  return <div>
    <h2 style={{ fontSize:20,fontWeight:400,marginBottom:16,color:c.text,fontFamily:serif }}>Learn</h2>
    <div style={{ display:'flex',gap:0,marginBottom:22,background:c.bgCard,borderRadius:10,border:`1px solid ${c.border}`,overflow:'hidden' }}>
      {[{id:'protocols',label:'Protocols'},{id:'education',label:'Testosterone 101'},{id:'sources',label:'Sources'}].map(t=>
        <button key={t.id} onClick={()=>setLearnTab(t.id)} style={{ flex:1,padding:'11px 8px',background:learnTab===t.id?c.bgElevated:'transparent',border:'none',cursor:'pointer',color:learnTab===t.id?c.accent:c.textMuted,fontSize:11,fontWeight:600,fontFamily:sans,letterSpacing:0.3,transition:'all 0.2s',borderBottom:learnTab===t.id?`2px solid ${c.accent}`:'2px solid transparent' }}>{t.label}</button>
      )}
    </div>

    {learnTab==='protocols'&&<div>
      <p style={{ fontSize:13,color:c.textSec,marginBottom:18,lineHeight:1.5,fontFamily:sans }}>Follow in order for best results.</p>
      {PROTOCOLS.map(pr=>{const lk=pr.tier==='premium'&&!isPremium; return <button key={pr.id} onClick={()=>onSelect(pr)} style={{ width:'100%',textAlign:'left',background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:18,marginBottom:10,cursor:'pointer',display:'flex',alignItems:'center',gap:14 }}><div style={{ width:48,height:48,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,background:c.bgElevated,border:`1px solid ${c.borderLight}`,flexShrink:0 }}>{pr.icon}</div><div style={{ flex:1 }}><div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:3 }}><span style={{ fontSize:15,fontWeight:700,color:c.text,fontFamily:sans }}>{pr.title}</span>{lk&&<span style={{ fontSize:12,color:c.accent }}>🔒</span>}</div><div style={{ fontSize:12,color:c.textMuted,fontFamily:sans }}>{pr.level} · {pr.duration}</div></div><span style={{ color:c.textMuted,fontSize:16,flexShrink:0 }}>›</span></button>;})}
      {!isPremium&&<div style={{ background:c.accentGlow,border:`1px solid ${c.accent}25`,borderRadius:12,padding:18,textAlign:'center',marginTop:8 }}><p style={{ fontSize:13,color:c.textSec,marginBottom:10,fontFamily:sans }}>Unlock all protocols with Premium</p><button onClick={onUpgrade} style={{ cursor:'pointer',background:c.accent,border:'none',color:c.bg,fontWeight:700,fontSize:13,padding:'11px 22px',borderRadius:8,fontFamily:sans }}>Start Free Trial — $8.99/mo</button></div>}
    </div>}

    {learnTab==='education'&&<div>
      {T_EDUCATION.map(item=><div key={item.id} style={{ background:c.bgCard,border:`1px solid ${expandedEdu===item.id?c.accent+'40':c.border}`,borderRadius:12,marginBottom:10,overflow:'hidden',transition:'border-color 0.2s' }}>
        <button onClick={()=>setExpandedEdu(expandedEdu===item.id?null:item.id)} style={{ width:'100%',display:'flex',alignItems:'center',gap:14,padding:'16px 18px',background:'none',border:'none',cursor:'pointer',textAlign:'left' }}>
          <span style={{ fontSize:22 }}>{item.icon}</span>
          <span style={{ flex:1,fontSize:15,fontWeight:600,color:c.text,fontFamily:sans }}>{item.title}</span>
          <span style={{ color:c.textMuted,fontSize:16,transform:expandedEdu===item.id?'rotate(90deg)':'rotate(0)',transition:'transform 0.2s' }}>›</span>
        </button>
        {expandedEdu===item.id&&<div style={{ padding:'0 18px 18px' }}>
          {item.content.split('. ').reduce((acc, sentence, i, arr) => {
            const text = sentence + (i < arr.length - 1 ? '.' : '');
            if (text.trim()) acc.push(text);
            return acc;
          }, []).map((line, i) => <div key={i} style={{ display:'flex',alignItems:'flex-start',gap:8,marginBottom:8 }}>
            <span style={{ color:c.accent,fontSize:14,fontWeight:300,marginTop:1,flexShrink:0 }}>+</span>
            <span style={{ fontSize:13,lineHeight:1.7,color:c.textSec,fontFamily:sans }}>{line.trim()}</span>
          </div>)}
        </div>}
      </div>)}
    </div>}

    {learnTab==='sources'&&<div>
      <p style={{ fontSize:13,color:c.textSec,marginBottom:18,lineHeight:1.5,fontFamily:sans }}>The science behind every protocol and habit in Andros. Tap any study to read the full paper.</p>
      {SOURCES.map((s,i)=><a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ display:'block',background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,padding:16,marginBottom:8,textDecoration:'none',transition:'border-color 0.2s' }}>
        <div style={{ fontSize:13,fontWeight:600,color:c.text,fontFamily:sans,marginBottom:4 }}>{s.title}</div>
        <div style={{ fontSize:11,color:c.textMuted,fontFamily:sans }}>{s.source}</div>
      </a>)}
    </div>}
  </div>;
}

// Notification scheduler
let notifTimer = null;
function scheduleNotification(timeStr) {
  if (notifTimer) clearTimeout(notifTimer);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const schedule = () => {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const ms = target - now;
    notifTimer = setTimeout(() => {
      new Notification('Andros Daily Reminder', {
        body: 'Time to check in on your testosterone optimization habits.',
        icon: '/icon-192.png',
        badge: '/icon-192.png'
      });
      schedule(); // re-schedule for next day
    }, ms);
  };
  schedule();
}
// Auto-start notifications if enabled
if (typeof window !== 'undefined' && localStorage.getItem('andros_notif') === 'on') {
  scheduleNotification(localStorage.getItem('andros_notif_time') || '09:00');
}

function ProfileView({ user, isPremium, onUpgrade, onLogout, onUpdateUser }) {
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [editName, setEditName] = useState(user.name || '');
  const [nameMsg, setNameMsg] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(localStorage.getItem('andros_notif') !== 'off');
  const [notifTime, setNotifTime] = useState(localStorage.getItem('andros_notif_time') || '09:00');

  const handleNameSave = async () => {
    if (!editName.trim()) return;
    try {
      if (USE_SUPABASE) {
        const sb = getSupabase();
        await sb.update('profiles', { name: editName.trim() }, { eq: { id: user.id } });
      }
      if (onUpdateUser) onUpdateUser({ ...user, name: editName.trim() });
      setNameMsg('Name updated');
      setTimeout(() => { setShowNameEdit(false); setNameMsg(''); }, 1500);
    } catch(e) { setNameMsg('Failed to update'); }
  };

  const handlePasswordChange = async () => {
    if (!newPw || newPw.length < 6) { setPwMsg('Password must be at least 6 characters'); return; }
    setPwLoading(true); setPwMsg('');
    try {
      if (USE_SUPABASE) {
        const sb = getSupabase();
        const res = await fetch(`${sb.url}/auth/v1/user`, {
          method: 'PUT', headers: { ...sb.headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: newPw })
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.msg || 'Failed to update password'); }
      }
      setPwMsg('Password updated successfully');
      setNewPw(''); setCurrentPw('');
      setTimeout(() => { setShowPasswordChange(false); setPwMsg(''); }, 2000);
    } catch(e) { setPwMsg(e.message || 'Failed to update password'); }
    setPwLoading(false);
  };

  const handleManageSubscription = async () => {
    if (!USE_SUPABASE) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ user_id: user.id, email: user.email })
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert('No active subscription found. If you recently subscribed, try logging out and back in. For help, contact support@andros.bio');
    } catch(e) { alert('Unable to connect to subscription management. Check your internet connection and try again.'); }
  };

  const handleNotifToggle = async () => {
    if (!notifEnabled) {
      // Turning on
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          setNotifEnabled(true);
          localStorage.setItem('andros_notif', 'on');
          scheduleNotification(notifTime);
        } else {
          alert('Please enable notifications in your browser settings to use this feature.');
        }
      } else {
        alert('Notifications are not supported in this browser.');
      }
    } else {
      setNotifEnabled(false);
      localStorage.setItem('andros_notif', 'off');
    }
  };

  const handleNotifTimeChange = (t) => {
    setNotifTime(t);
    localStorage.setItem('andros_notif_time', t);
    if (notifEnabled) scheduleNotification(t);
  };

  const inp = { width:'100%',background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:8,padding:'12px 14px',fontSize:14,color:c.text,outline:'none',boxSizing:'border-box',fontFamily:sans };
  const sectionStyle = { background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:12,overflow:'hidden',marginBottom:12 };
  const rowStyle = { display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 18px',cursor:'pointer',borderBottom:`1px solid ${c.border}` };
  const rowLabel = { fontSize:14,color:c.text,fontFamily:sans };
  const rowValue = { fontSize:13,color:c.textMuted,fontFamily:sans };

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  return <div style={{ paddingTop:20 }}>
    {/* Avatar & Name */}
    <div style={{ textAlign:'center',marginBottom:24 }}>
      <div style={{ width:72,height:72,borderRadius:'50%',margin:'0 auto 14px',background:`linear-gradient(135deg,${c.accent},${c.accentDim})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,fontWeight:700,color:c.bg,fontFamily:serif }}>{user.name?user.name[0].toUpperCase():'?'}</div>
      {!showNameEdit ? <div>
        <h2 style={{ fontSize:20,fontWeight:400,marginBottom:4,fontFamily:serif,color:c.text }}>{user.name}</h2>
        <button onClick={()=>setShowNameEdit(true)} style={{ background:'none',border:'none',color:c.textMuted,fontSize:11,cursor:'pointer',fontFamily:sans,textDecoration:'underline' }}>Edit name</button>
      </div> : <div style={{ display:'flex',gap:8,maxWidth:260,margin:'0 auto' }}>
        <input value={editName} onChange={e=>setEditName(e.target.value)} style={{...inp,fontSize:16,textAlign:'center',padding:'8px 12px'}} />
        <button onClick={handleNameSave} style={{ background:c.accent,border:'none',borderRadius:8,color:c.bg,fontWeight:700,fontSize:12,padding:'8px 14px',cursor:'pointer',fontFamily:sans,flexShrink:0 }}>Save</button>
      </div>}
      {nameMsg&&<p style={{ fontSize:11,color:c.success,marginTop:6,fontFamily:sans }}>{nameMsg}</p>}
      <p style={{ fontSize:13,color:c.textSec,marginTop:6 }}>{user.email}</p>
      {isPremium&&<div style={{ display:'inline-flex',alignItems:'center',gap:6,background:c.premiumGlow,border:`1px solid ${c.accent}40`,borderRadius:16,padding:'5px 14px',fontSize:12,fontWeight:600,color:c.accent,marginTop:10 }}>+ Premium</div>}
    </div>

    {/* Install prompt - only show if not already installed */}
    {!isStandalone&&<div style={{ background:c.accentGlow,border:`1px solid ${c.accent}30`,borderRadius:12,padding:18,marginBottom:20,textAlign:'center' }}>
      <div style={{ fontSize:13,fontWeight:600,color:c.accent,marginBottom:6,fontFamily:sans }}>Install Andros on your phone</div>
      <p style={{ fontSize:12,color:c.textSec,lineHeight:1.6,marginBottom:10,fontFamily:sans }}>
        {isIOS ? 'Tap the Share button at the bottom of Safari, then tap "Add to Home Screen"'
          : isAndroid ? 'Tap the three dots menu in Chrome, then "Add to Home Screen"'
          : 'Use your browser menu to "Add to Home Screen" or "Install App"'}
      </p>
      <p style={{ fontSize:11,color:c.textMuted,fontFamily:sans }}>Opens fullscreen — just like a real app</p>
    </div>}

    {/* Subscription */}
    <div style={{ fontSize:11,fontWeight:600,color:c.textMuted,textTransform:'uppercase',letterSpacing:1.5,marginBottom:8,paddingLeft:4,fontFamily:sans }}>Subscription</div>
    <div style={sectionStyle}>
      {isPremium ? <>
        <div style={rowStyle}>
          <span style={rowLabel}>Plan</span>
          <span style={{ ...rowValue, color:c.accent, fontWeight:600 }}>Premium — $8.99/mo</span>
        </div>
        <div style={{...rowStyle, borderBottom:'none'}} onClick={handleManageSubscription}>
          <span style={rowLabel}>Manage Subscription</span>
          <span style={{ color:c.textMuted, fontSize:14 }}>›</span>
        </div>
      </> : <div style={{...rowStyle, borderBottom:'none'}} onClick={onUpgrade}>
        <span style={rowLabel}>Upgrade to Premium</span>
        <span style={{ color:c.accent, fontSize:13, fontWeight:600 }}>$8.99/mo →</span>
      </div>}
    </div>

    {/* Account */}
    <div style={{ fontSize:11,fontWeight:600,color:c.textMuted,textTransform:'uppercase',letterSpacing:1.5,marginBottom:8,paddingLeft:4,fontFamily:sans,marginTop:20 }}>Account</div>
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <span style={rowLabel}>Email</span>
        <span style={rowValue}>{user.email}</span>
      </div>
      <div style={{...rowStyle, borderBottom:'none'}} onClick={()=>setShowPasswordChange(!showPasswordChange)}>
        <span style={rowLabel}>Change Password</span>
        <span style={{ color:c.textMuted, fontSize:14, transform:showPasswordChange?'rotate(90deg)':'rotate(0)', transition:'transform 0.2s' }}>›</span>
      </div>
      {showPasswordChange&&<div style={{ padding:'0 18px 18px' }}>
        <div style={{ marginBottom:10 }}>
          <input type="password" placeholder="New password (min 6 characters)" value={newPw} onChange={e=>setNewPw(e.target.value)} style={inp} />
        </div>
        <button onClick={handlePasswordChange} disabled={pwLoading} style={{ width:'100%',padding:12,borderRadius:8,border:'none',background:c.accent,color:c.bg,fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:sans,opacity:pwLoading?0.6:1 }}>{pwLoading?'Updating...':'Update Password'}</button>
        {pwMsg&&<p style={{ fontSize:12,marginTop:8,color:pwMsg.includes('success')?c.success:c.danger,fontFamily:sans,textAlign:'center' }}>{pwMsg}</p>}
      </div>}
    </div>

    {/* Notifications */}
    <div style={{ fontSize:11,fontWeight:600,color:c.textMuted,textTransform:'uppercase',letterSpacing:1.5,marginBottom:8,paddingLeft:4,fontFamily:sans,marginTop:20 }}>Notifications</div>
    <div style={sectionStyle}>
      <div style={{...rowStyle}} onClick={handleNotifToggle}>
        <span style={rowLabel}>Daily Reminder</span>
        <div style={{ width:44,height:24,borderRadius:12,background:notifEnabled?c.accent:c.bgElevated,border:`1px solid ${notifEnabled?c.accent:c.border}`,position:'relative',transition:'all 0.2s',cursor:'pointer' }}>
          <div style={{ width:20,height:20,borderRadius:10,background:notifEnabled?c.bg:'#555',position:'absolute',top:1,left:notifEnabled?22:1,transition:'all 0.2s' }}/>
        </div>
      </div>
      {notifEnabled&&<div style={{...rowStyle, borderBottom:'none'}}>
        <span style={rowLabel}>Reminder Time</span>
        <input type="time" value={notifTime} onChange={e=>handleNotifTimeChange(e.target.value)} style={{ background:c.bgElevated,border:`1px solid ${c.border}`,borderRadius:6,padding:'6px 10px',color:c.text,fontSize:13,fontFamily:sans,outline:'none' }} />
      </div>}
    </div>

    {/* App Info */}
    <div style={{ fontSize:11,fontWeight:600,color:c.textMuted,textTransform:'uppercase',letterSpacing:1.5,marginBottom:8,paddingLeft:4,fontFamily:sans,marginTop:20 }}>App</div>
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <span style={rowLabel}>Sync</span>
        <span style={{ ...rowValue, color:USE_SUPABASE?c.success:c.textMuted }}>{USE_SUPABASE?'☁ Cloud sync active':'Offline mode'}</span>
      </div>
      <div style={rowStyle}>
        <span style={rowLabel}>Version</span>
        <span style={rowValue}>1.0.0</span>
      </div>
      <div style={{...rowStyle}} onClick={()=>setShowPrivacy(!showPrivacy)}>
        <span style={rowLabel}>Privacy Policy</span>
        <span style={{ color:c.textMuted, fontSize:14 }}>›</span>
      </div>
      <div style={{...rowStyle, borderBottom:'none'}} onClick={()=>setShowTerms(!showTerms)}>
        <span style={rowLabel}>Terms of Service</span>
        <span style={{ color:c.textMuted, fontSize:14 }}>›</span>
      </div>
    </div>

    {/* Privacy Policy Modal */}
    {showPrivacy&&<div onClick={()=>setShowPrivacy(false)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:16,padding:28,maxWidth:500,width:'100%',maxHeight:'80vh',overflowY:'auto' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}><h3 style={{ fontSize:18,fontWeight:700,color:c.text,fontFamily:sans }}>Privacy Policy</h3><button onClick={()=>setShowPrivacy(false)} style={{ background:'none',border:'none',color:c.textMuted,cursor:'pointer',fontSize:18 }}>✕</button></div>
        <div style={{ fontSize:13,lineHeight:1.8,color:c.textSec,fontFamily:sans }}>
          <p style={{ marginBottom:12 }}><strong style={{ color:c.text }}>Effective Date:</strong> February 2026</p>
          <p style={{ marginBottom:12 }}>Andros ("we", "our", "us") operates the website andros.bio. This page informs you of our policies regarding the collection, use, and disclosure of personal data.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Data We Collect</strong></p>
          <p style={{ marginBottom:12 }}>We collect your email address and name when you create an account. We store your habit check-ins, mood logs, and sleep logs to provide the service. Payment processing is handled by Stripe — we never see or store your credit card information.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>How We Use Your Data</strong></p>
          <p style={{ marginBottom:12 }}>Your data is used solely to provide and improve the Andros service. We do not sell, trade, or rent your personal information to third parties. We do not serve ads.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Data Storage & Security</strong></p>
          <p style={{ marginBottom:12 }}>Your data is stored securely on Supabase (PostgreSQL) with row-level security policies. All data is transmitted over HTTPS. We use industry-standard encryption.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Your Rights</strong></p>
          <p style={{ marginBottom:12 }}>You may request deletion of your account and all associated data at any time by contacting support@andros.bio. You may export your data upon request.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Contact</strong></p>
          <p>For privacy questions, email support@andros.bio.</p>
        </div>
      </div>
    </div>}

    {/* Terms of Service Modal */}
    {showTerms&&<div onClick={()=>setShowTerms(false)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:16,padding:28,maxWidth:500,width:'100%',maxHeight:'80vh',overflowY:'auto' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}><h3 style={{ fontSize:18,fontWeight:700,color:c.text,fontFamily:sans }}>Terms of Service</h3><button onClick={()=>setShowTerms(false)} style={{ background:'none',border:'none',color:c.textMuted,cursor:'pointer',fontSize:18 }}>✕</button></div>
        <div style={{ fontSize:13,lineHeight:1.8,color:c.textSec,fontFamily:sans }}>
          <p style={{ marginBottom:12 }}><strong style={{ color:c.text }}>Effective Date:</strong> February 2026</p>
          <p style={{ marginBottom:12 }}>By using Andros, you agree to these terms. Please read them carefully.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>The Service</strong></p>
          <p style={{ marginBottom:12 }}>Andros is a habit-tracking tool designed to help users build science-backed daily routines. We are not a medical service. Andros does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider before making changes to your health routine.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Subscriptions & Billing</strong></p>
          <p style={{ marginBottom:12 }}>Premium subscriptions are billed monthly at $8.99/month through Stripe. A 7-day free trial is included with new subscriptions. You may cancel at any time through your account settings — cancellation takes effect at the end of your current billing period. No refunds are provided for partial months.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>User Conduct</strong></p>
          <p style={{ marginBottom:12 }}>You agree not to misuse the service, attempt to gain unauthorized access, or use the service for any unlawful purpose.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Disclaimer</strong></p>
          <p style={{ marginBottom:12 }}>The information provided in Andros is for educational and informational purposes only. Results may vary. Testosterone levels are influenced by many factors including genetics, age, medical conditions, and lifestyle. We make no guarantees about specific health outcomes.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Limitation of Liability</strong></p>
          <p style={{ marginBottom:12 }}>Andros is provided "as is" without warranties of any kind. We are not liable for any damages arising from your use of the service.</p>
          <p style={{ marginBottom:8 }}><strong style={{ color:c.text }}>Contact</strong></p>
          <p>For questions about these terms, email support@andros.bio.</p>
        </div>
      </div>
    </div>}

    {/* Logout */}
    <button onClick={onLogout} style={{ width:'100%',padding:14,borderRadius:10,cursor:'pointer',border:`1px solid ${c.border}`,background:'none',color:c.danger,fontSize:14,fontWeight:500,fontFamily:sans,marginTop:20,marginBottom:40 }}>Log Out</button>
  </div>;
}

function Scorecard({ tScore, streak, moodLog, sleepLog, todayCheckins, onClose, isPremium, onUpgrade }) {
  const today = getToday();
  const mood = moodLog[today];
  const sleep = sleepLog[today];
  const moodEmoji = mood ? MOOD_OPTIONS.find(m => m.value === mood.value)?.emoji : null;
  const scoreInfo = getScoreLabel(tScore.total);
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (!isPremium) {
    return <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:c.bgCard,border:`1px solid ${c.border}`,borderRadius:20,padding:32,maxWidth:380,width:'100%',textAlign:'center' }}>
        <div style={{ fontSize:48,marginBottom:16 }}>🔒</div>
        <h3 style={{ fontSize:20,fontWeight:700,color:c.text,fontFamily:serif,marginBottom:8 }}>Testosterone Score</h3>
        <p style={{ fontSize:14,color:c.textSec,lineHeight:1.6,marginBottom:24,fontFamily:sans }}>Your daily T-Score is calculated from your habits, sleep streak, training consistency, and nutrition patterns — weighted by scientific impact on testosterone production.</p>
        <button onClick={(e)=>{e.stopPropagation();onUpgrade();}} style={{ width:'100%',padding:14,borderRadius:10,border:'none',background:c.accent,color:c.bg,fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:sans }}>Unlock Premium — $8.99/mo</button>
        <p style={{ fontSize:11,color:c.textMuted,marginTop:10,fontFamily:sans }}>7-day free trial</p>
        <button onClick={onClose} style={{ background:'none',border:'none',color:c.textMuted,cursor:'pointer',fontSize:13,marginTop:16,fontFamily:sans }}>Maybe later</button>
      </div>
    </div>;
  }

  return <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16 }}>
    <div onClick={e=>e.stopPropagation()} style={{ background:`linear-gradient(180deg, ${c.bgCard} 0%, ${c.bg} 100%)`,border:`1px solid ${c.border}`,borderRadius:24,padding:0,maxWidth:380,width:'100%',overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'28px 28px 0',textAlign:'center' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
          <Logo size="small" />
          <button onClick={onClose} style={{ background:'none',border:'none',color:c.textMuted,cursor:'pointer',fontSize:16 }}>✕</button>
        </div>
        <div style={{ fontSize:11,color:c.textMuted,textTransform:'uppercase',letterSpacing:2,fontFamily:sans,marginBottom:4 }}>{dateStr}</div>
        <div style={{ fontSize:10,color:c.textMuted,letterSpacing:1.5,fontFamily:sans,marginBottom:20 }}>DAILY TESTOSTERONE SCORE</div>
      </div>

      {/* Big Score */}
      <div style={{ textAlign:'center',padding:'0 28px 24px' }}>
        <div style={{ position:'relative',width:160,height:160,margin:'0 auto' }}>
          <svg width="160" height="160" viewBox="0 0 160 160" style={{ transform:'rotate(-90deg)' }}>
            <circle cx="80" cy="80" r="70" fill="none" stroke={c.bgElevated} strokeWidth="8" />
            <circle cx="80" cy="80" r="70" fill="none" stroke={scoreInfo.color} strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 70 * tScore.total / 100} ${2 * Math.PI * 70}`}
              strokeLinecap="round" style={{ transition:'stroke-dasharray 1s ease' }} />
          </svg>
          <div style={{ position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}>
            <div style={{ fontSize:52,fontWeight:700,fontFamily:serif,color:c.text,lineHeight:1 }}>{tScore.total}</div>
            <div style={{ fontSize:12,fontWeight:600,color:scoreInfo.color,fontFamily:sans,marginTop:4 }}>{scoreInfo.label}</div>
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div style={{ padding:'0 24px 20px' }}>
        {Object.entries(SCORE_CATEGORIES).map(([key, cat]) => {
          const data = tScore.breakdown[key];
          const pct = (data.score / data.max) * 100;
          return <div key={key} style={{ marginBottom:12 }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5 }}>
              <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                <span style={{ fontSize:14 }}>{cat.icon}</span>
                <span style={{ fontSize:12,fontWeight:600,color:c.text,fontFamily:sans }}>{cat.label}</span>
              </div>
              <span style={{ fontSize:12,fontFamily:'monospace',color:c.textSec }}>{data.score}/{data.max}</span>
            </div>
            <div style={{ height:5,background:c.bgElevated,borderRadius:3,overflow:'hidden' }}>
              <div style={{ height:'100%',borderRadius:3,width:pct+'%',background:pct>=80?c.accent:pct>=50?c.warning:'#c47a3a',transition:'width 0.6s ease' }} />
            </div>
            {key==='sleep'&&data.streak>0&&<div style={{ fontSize:10,color:c.textMuted,marginTop:3,fontFamily:sans }}>{data.streak} day sleep streak</div>}
            {key==='training'&&<div style={{ fontSize:10,color:c.textMuted,marginTop:3,fontFamily:sans }}>{data.days} training day{data.days!==1?'s':''} this week</div>}
          </div>;
        })}
      </div>

      {/* Today's Inputs */}
      <div style={{ padding:'0 24px 20px',display:'flex',gap:10 }}>
        <div style={{ flex:1,background:c.bgElevated,borderRadius:10,padding:'12px 14px',textAlign:'center' }}>
          <div style={{ fontSize:11,color:c.textMuted,fontFamily:sans,marginBottom:4 }}>Habits</div>
          <div style={{ fontSize:20,fontWeight:700,fontFamily:serif,color:c.text }}>{todayCheckins.length}<span style={{ fontSize:12,fontWeight:400,color:c.textMuted }}>/{DEFAULT_HABITS.length}</span></div>
        </div>
        <div style={{ flex:1,background:c.bgElevated,borderRadius:10,padding:'12px 14px',textAlign:'center' }}>
          <div style={{ fontSize:11,color:c.textMuted,fontFamily:sans,marginBottom:4 }}>Mood</div>
          <div style={{ fontSize:20 }}>{moodEmoji || '—'}</div>
        </div>
        <div style={{ flex:1,background:c.bgElevated,borderRadius:10,padding:'12px 14px',textAlign:'center' }}>
          <div style={{ fontSize:11,color:c.textMuted,fontFamily:sans,marginBottom:4 }}>Sleep</div>
          <div style={{ fontSize:20,fontWeight:700,fontFamily:serif,color:c.text }}>{sleep?sleep.hours+'h':'—'}</div>
        </div>
        <div style={{ flex:1,background:c.bgElevated,borderRadius:10,padding:'12px 14px',textAlign:'center' }}>
          <div style={{ fontSize:11,color:c.textMuted,fontFamily:sans,marginBottom:4 }}>Streak</div>
          <div style={{ fontSize:20,fontWeight:700,fontFamily:serif,color:c.text }}>{tScore.consistency.streak}<span style={{ fontSize:12 }}>🔥</span></div>
        </div>
      </div>

      {/* Consistency bonus */}
      <div style={{ padding:'0 24px 24px' }}>
        <div style={{ background:c.bgElevated,borderRadius:10,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div>
            <div style={{ fontSize:12,fontWeight:600,color:c.text,fontFamily:sans }}>Consistency Bonus</div>
            <div style={{ fontSize:10,color:c.textMuted,fontFamily:sans,marginTop:2 }}>{tScore.consistency.streak>=30?'Maximum bonus reached':'Maintain streak to increase bonus'}</div>
          </div>
          <div style={{ fontSize:14,fontWeight:700,color:c.accent,fontFamily:'monospace' }}>+{Math.round(tScore.consistency.mult * 20)}%</div>
        </div>
      </div>

      {/* Footer branding */}
      <div style={{ borderTop:`1px solid ${c.border}`,padding:'14px 24px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        <Logo size="small" />
        <span style={{ fontSize:10,color:c.textMuted,fontFamily:sans }}>andros.bio</span>
      </div>
    </div>
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
  const [loading,setLoading]=useState(true);const [checkoutMessage,setCheckoutMessage]=useState('');const [showScorecard,setShowScorecard]=useState(false);

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

  const logMood = async (value, symptoms = [], note = '') => {
    const todayStr = getToday();
    setMoodLog(prev=>({...prev,[todayStr]:{value,symptoms,note,time:new Date().toISOString()}}));
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
  const tScore = calculateTScore(checkins, sleepLog);

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
        <button onClick={()=>setShowScorecard(true)} style={{ width:'100%',marginTop:24,padding:16,borderRadius:12,border:'none',cursor:'pointer',background:`linear-gradient(135deg,${c.accent},${c.accentDim})`,color:c.bg,fontSize:16,fontWeight:700,fontFamily:sans,letterSpacing:0.5,boxShadow:'0 4px 20px rgba(212,164,74,0.25)' }}>Get My Score</button>
      </div>}
      {tab==='protocols'&&(selectedProtocol?<ProtocolDetail protocol={selectedProtocol} onBack={()=>setSelectedProtocol(null)} isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} />:<ProtocolsView isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} onSelect={setSelectedProtocol} />)}
      {tab==='stats'&&<StatsView checkins={checkins} moodLog={moodLog} sleepLog={sleepLog} isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} />}
      {tab==='profile'&&<ProfileView user={user} isPremium={isPremium} onUpgrade={()=>setShowPremium(true)} onLogout={handleLogout} onUpdateUser={setUser} />}
    </main>
    <nav style={{ position:'fixed',bottom:0,left:0,right:0,display:'flex',justifyContent:'space-around',background:'rgba(15,13,10,0.97)',borderTop:`1px solid ${c.border}`,padding:'14px 0 18px',zIndex:100 }}>
      {[{id:'today',label:'TODAY'},{id:'protocols',label:'LEARN'},{id:'stats',label:'STATS'},{id:'profile',label:'PROFILE'}].map(t=><button key={t.id} onClick={()=>{setTab(t.id);if(t.id!=='protocols')setSelectedProtocol(null);}} style={{ padding:'4px 18px',background:'none',border:'none',cursor:'pointer',color:tab===t.id?c.accent:c.textMuted,transition:'color 0.2s',fontFamily:sans,fontSize:11,fontWeight:700,letterSpacing:1.8,position:'relative' }}>{t.label}{tab===t.id&&<div style={{ position:'absolute',top:-14,left:'50%',transform:'translateX(-50)',width:16,height:2,background:c.accent,borderRadius:1 }}/>}</button>)}
    </nav>
    {scienceHabit&&<ScienceModal habit={scienceHabit} onClose={()=>setScienceHabit(null)} />}
    {showPremium&&<PremiumModal onClose={()=>setShowPremium(false)} onUpgrade={handleUpgrade} user={user} />}
    {showScorecard&&<Scorecard tScore={tScore} streak={streak} moodLog={moodLog} sleepLog={sleepLog} todayCheckins={todayCheckins} onClose={()=>setShowScorecard(false)} isPremium={isPremium} onUpgrade={()=>{setShowScorecard(false);setShowPremium(true);}} />}
  </div>;
}
