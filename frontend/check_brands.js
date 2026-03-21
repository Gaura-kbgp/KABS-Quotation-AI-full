const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  try {
    const { data: manufacturers, error: mError } = await supabase.from('manufacturers').select('*');
    if (mError) throw mError;

    console.log('--- MANUFACTURERS ---');
    manufacturers.forEach(m => console.log(`ID: ${m.id} | Name: ${m.name}`));

    for (const m of manufacturers) {
      console.log(`\nChecking: ${m.name}`);
      const { data: pricing, error: pError } = await supabase
        .from('manufacturer_pricing')
        .select('collection_name, door_style')
        .eq('manufacturer_id', m.id)
        .limit(10); // Sample test

      if (pError) {
        console.error(`Error for ${m.name}:`, pError.message);
        continue;
      }

      console.log(`Sample Row:`, pricing[0]);
      
      const { data: counts, error: cError } = await supabase
        .from('manufacturer_pricing')
        .select('collection_name', { count: 'exact', head: false })
        .eq('manufacturer_id', m.id);
      
      const uniqueCollections = [...new Set(counts?.map(c => c.collection_name))];
      console.log(`Total rows: ${counts?.length || 0}`);
      console.log(`Unique Collections:`, uniqueCollections);
    }
  } catch (err) {
    console.error('CRITICAL ERROR:', err.message);
  }
}

check();
