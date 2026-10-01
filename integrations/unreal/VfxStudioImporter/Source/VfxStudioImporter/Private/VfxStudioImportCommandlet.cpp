#include "VfxStudioImportCommandlet.h"
#include "VfxNiagaraImporter.h"

DEFINE_LOG_CATEGORY_STATIC(LogVfxImportCommandlet, Log, All);

int32 UVfxStudioImportCommandlet::Main(const FString& Params)
{
	TMap<FString, FString> ParamMap;
	TArray<FString> Tokens, Switches;
	ParseCommandLine(*Params, Tokens, Switches, ParamMap);

	if (Switches.Contains(TEXT("DumpTemplates")))
	{
		UVfxNiagaraImporter::DumpTemplates();
		return 0;
	}
	const FString* Package = ParamMap.Find(TEXT("Package"));
	const FString* Dest = ParamMap.Find(TEXT("Dest"));
	if (!Package || Package->IsEmpty() || !Dest || Dest->IsEmpty())
	{
		UE_LOG(LogVfxImportCommandlet, Error, TEXT("Usage: -run=VfxStudioImport -Package=\"<folder with effect.json>\" -Dest=/Game/VFXStudio/<name>"));
		return 1;
	}
	UE_LOG(LogVfxImportCommandlet, Warning, TEXT("VfxStudioImport: Package=%s Dest=%s"), **Package, **Dest);
	const bool bOk = UVfxNiagaraImporter::ImportPackage(*Package, *Dest);
	UE_LOG(LogVfxImportCommandlet, Warning, TEXT("VfxStudioImport: %s"), bOk ? TEXT("SUCCEEDED") : TEXT("FAILED"));
	return bOk ? 0 : 1;
}
