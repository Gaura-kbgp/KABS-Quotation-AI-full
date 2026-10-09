import { apiUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { logUsage } from '@/lib/usage';
import { analyzeDrawing } from '@/ai/flows/analyze-drawing-flow';
import * as fs from 'fs';

export const maxDuration = 600; // Increased to 10 minutes for large drawing sets

function logHit(msg: string) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync('route_hit.log', `[${timestamp}] ${msg}\n`);
}

export async function POST(req: Request) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    logHit("POST /api/upload-drawing - START");
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const projectName = (formData.get('projectName') as string) || 'NEW PROJECT';

    if (!file) {
      logHit("ERROR: No file provided");
      return Response.json({ error: 'No PDF provided.' }, { status: 400 });
    }

    const supabase = await scopedDb();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Initial Storage Upload
    const fileName = `${crypto.randomUUID()}.pdf`;
    const storagePath = `${auth.user.orgId}/quotations/drawings/${fileName}`;
    
    logHit(`Uploading to Storage: ${storagePath}`);
    const { data: uploadData, error: uploadError } = await supabase.storage.from('manufacturer-docs').upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    if (uploadError) {
      logHit(`Storage Error: ${uploadError.message}`);
      throw uploadError;
    }
    
    // The bucket is private: store the path, not a public URL. The backend
    // reads it directly with the service-role key (app/core/storage.py).
    logHit(`Storage path: ${storagePath}`);

    // 2. Create Project Record
    logHit("Creating DB record...");
    const { data: project, error: dbError } = await supabase
      .from('quotation_projects')
      .insert([{
        project_name: projectName,
        raw_pdf_url: storagePath,
        status: 'Processing'
      }])
      .select()
      .single();

    if (dbError) {
      logHit(`DB Insert Error: ${dbError.message}`);
      throw dbError;
    }

    // 3. Extract cabinet data — local rule-based extractor runs first (fast).
    //    Smart Agent refinement is available on-demand via the Review page button.
    logHit(`Triggering extraction for project ${project.id}...`);

    try {
      const startTime = Date.now();
      const result = await analyzeDrawing({
        pdfDataUri: storagePath,
        projectName: projectName
      });
      const scanDuration = (Date.now() - startTime) / 1000;
      logHit(`Extraction finished in ${scanDuration}s. Rooms: ${result.rooms?.length ?? 0}`);

      const finalExtractedData = {
        rooms: result.rooms || [],
        smart_agent_explanations: []
      };

      logHit("Saving result...");
      fs.writeFileSync(`scan_result_${project.id}.json`, JSON.stringify(finalExtractedData, null, 2));

      logHit("Updating Supabase with extracted data...");
      const { error: updateError } = await supabase
        .from('quotation_projects')
        .update({
          extracted_data: finalExtractedData,
          status: 'Reviewing'
        })
        .eq('id', project.id);

      if (updateError) {
        logHit(`Supabase Update Error: ${updateError.message}`);
      } else {
        logHit("Supabase Update Success.");
      }
    } catch (e: any) {
      logHit(`AI Flow Catch Error: ${e.message}`);
      console.error('[ROUTE] Analysis or Update Error:', e);
      
      // Update status to Error so the UI knows it failed
      await supabase
        .from('quotation_projects')
        .update({ status: 'Error', metadata: { last_error: e.message } })
        .eq('id', project.id);
    }

    await logUsage(auth.user, 'drawing.upload', { project_id: project.id, project_name: projectName });
    logHit("Returning final response.");
    return Response.json({ success: true, projectId: project.id });

  } catch (err: any) {
    logHit(`CRITICAL FAILURE: ${err.message}`);
    console.error('[ROUTE] Critical Failure:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
