#include "VfxNiagaraBuilder.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "UObject/UObjectGlobals.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"

#include "NiagaraSystem.h"
#include "NiagaraSystemFactoryNew.h"
#include "NiagaraEmitter.h"
#include "NiagaraEmitterHandle.h"
#include "NiagaraScript.h"
#include "NiagaraScriptSource.h"
#include "NiagaraGraph.h"
#include "NiagaraNodeOutput.h"
#include "NiagaraNodeFunctionCall.h"
#include "NiagaraSpriteRendererProperties.h"
#include "ViewModels/Stack/NiagaraStackGraphUtilities.h"

#include "NiagaraActor.h"
#include "NiagaraComponent.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "Engine/EngineBaseTypes.h"
#include "TextureResource.h"
#include "ImageUtils.h"
#include "RHIDefinitions.h"
#include "Containers/Ticker.h"

DEFINE_LOG_CATEGORY_STATIC(LogVfxSpike, Log, All);

namespace
{
	UNiagaraEmitter* LoadEmitterTemplate(const TCHAR* AssetPath)
	{
		UNiagaraEmitter* Emitter = LoadObject<UNiagaraEmitter>(nullptr, AssetPath);
		if (!Emitter)
		{
			UE_LOG(LogVfxSpike, Error, TEXT("Failed to load emitter template: %s"), AssetPath);
		}
		else
		{
			UE_LOG(LogVfxSpike, Warning, TEXT("Loaded emitter template: %s"), AssetPath);
		}
		return Emitter;
	}

	// Finds a module function-call node in the given graph whose display name
	// contains NameSubstring (case-insensitive), then overrides one of its
	// inputs to a literal string value (e.g. "80.0", "1.0,0.0,0.0").
	// NOTE: FNiagaraStackGraphUtilities::GetOrderedModuleNodes/GetAllModuleNodes
	// and UNiagaraGraph::FindOutputNode are NOT marked NIAGARAEDITOR_API in UE 5.8
	// (confirmed via LNK2019 unresolved external symbol when linking against them
	// from a separate module), so this walks UEdGraph::Nodes directly instead.
	bool OverrideModuleInputLiteral(UNiagaraGraph* Graph, const TCHAR* ModuleNameSubstring, const TCHAR* InputName, const FNiagaraTypeDefinition& Type, const FString& LiteralValue)
	{
		if (!Graph)
		{
			return false;
		}

		for (UEdGraphNode* Node : Graph->Nodes)
		{
			UNiagaraNodeFunctionCall* ModuleNode = Cast<UNiagaraNodeFunctionCall>(Node);
			if (!ModuleNode)
			{
				continue;
			}
			const FString FnName = ModuleNode->GetFunctionName();
			UE_LOG(LogVfxSpike, Warning, TEXT("  module: %s"), *FnName);

			if (FnName.Contains(ModuleNameSubstring))
			{
				const FName InputFName(InputName);
				FNiagaraParameterHandle Handle{ InputFName };
				UEdGraphPin& OverridePin = FNiagaraStackGraphUtilities::GetOrCreateStackFunctionInputOverridePin(
					*ModuleNode, Handle, Type, FGuid(), FGuid());
				OverridePin.DefaultValue = LiteralValue;
				UE_LOG(LogVfxSpike, Warning, TEXT("  -> overrode %s.%s = %s"), *FnName, InputName, *LiteralValue);
				return true;
			}
		}

		UE_LOG(LogVfxSpike, Warning, TEXT("  module containing '%s' not found"), ModuleNameSubstring);
		return false;
	}

	bool SaveAsset(UObject* Asset)
	{
		UPackage* Package = Asset->GetOutermost();
		Package->MarkPackageDirty();
		Package->FullyLoad();

		const FString PackageFileName = FPackageName::LongPackageNameToFilename(
			Package->GetName(), FPackageName::GetAssetPackageExtension());

		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_NoError;

		const bool bSaved = UPackage::SavePackage(Package, Asset, *PackageFileName, SaveArgs);
		UE_LOG(LogVfxSpike, Warning, TEXT("Save %s -> %s : %s"), *Asset->GetName(), *PackageFileName, bSaved ? TEXT("OK") : TEXT("FAILED"));
		return bSaved;
	}
}

bool UVfxNiagaraBuilder::BuildDemoSystem(const FString& AssetPath)
{
	UE_LOG(LogVfxSpike, Warning, TEXT("=== BuildDemoSystem(%s) ==="), *AssetPath);

	FString PackagePath, AssetName;
	AssetPath.Split(TEXT("/"), &PackagePath, &AssetName, ESearchCase::IgnoreCase, ESearchDir::FromEnd);
	if (AssetName.IsEmpty())
	{
		UE_LOG(LogVfxSpike, Error, TEXT("Bad asset path: %s"), *AssetPath);
		return false;
	}

	IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
	UNiagaraSystemFactoryNew* Factory = NewObject<UNiagaraSystemFactoryNew>();

	UObject* NewAsset = AssetTools.CreateAsset(AssetName, PackagePath, UNiagaraSystem::StaticClass(), Factory);
	UNiagaraSystem* System = Cast<UNiagaraSystem>(NewAsset);
	if (!System)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("CreateAsset(NiagaraSystem) failed"));
		return false;
	}
	UE_LOG(LogVfxSpike, Warning, TEXT("Created NiagaraSystem asset: %s"), *System->GetPathName());

	// --- Emitter 1: Fountain (velocity/gravity/lifetime already wired) ---
	UNiagaraEmitter* FountainTemplate = LoadEmitterTemplate(TEXT("/Niagara/DefaultAssets/Templates/Emitters/Fountain.Fountain"));
	// --- Emitter 2: SimpleSpriteBurst (burst-based spawn) ---
	UNiagaraEmitter* BurstTemplate = LoadEmitterTemplate(TEXT("/Niagara/DefaultAssets/Templates/Emitters/SimpleSpriteBurst.SimpleSpriteBurst"));

	if (!FountainTemplate || !BurstTemplate)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("One or both emitter templates failed to load; aborting build."));
		return false;
	}

	const FGuid FountainVersion = FountainTemplate->GetExposedVersion().VersionGuid;
	const FGuid BurstVersion = BurstTemplate->GetExposedVersion().VersionGuid;

	FNiagaraEmitterHandle FountainHandle = System->AddEmitterHandle(*FountainTemplate, TEXT("Fountain"), FountainVersion);
	FNiagaraEmitterHandle BurstHandle = System->AddEmitterHandle(*BurstTemplate, TEXT("Burst"), BurstVersion);
	UE_LOG(LogVfxSpike, Warning, TEXT("Added emitter handles: %s, %s (system now has %d emitters)"),
		*FountainHandle.GetName().ToString(), *BurstHandle.GetName().ToString(), System->GetEmitterHandles().Num());

	// Load a real engine sprite material so renderers have something valid to draw.
	UMaterialInterface* SpriteMaterial = LoadObject<UMaterialInterface>(nullptr,
		TEXT("/Niagara/DefaultAssets/DefaultSpriteMaterial.DefaultSpriteMaterial"));
	UE_LOG(LogVfxSpike, Warning, TEXT("DefaultSpriteMaterial load: %s"), SpriteMaterial ? TEXT("OK") : TEXT("FAILED"));

	for (FNiagaraEmitterHandle* Handle : { &FountainHandle, &BurstHandle })
	{
		FVersionedNiagaraEmitterData* EmitterData = Handle->GetEmitterData();
		if (!EmitterData)
		{
			UE_LOG(LogVfxSpike, Warning, TEXT("No emitter data for handle %s"), *Handle->GetName().ToString());
			continue;
		}

		UE_LOG(LogVfxSpike, Warning, TEXT("-- Emitter %s: %d renderer(s) --"), *Handle->GetName().ToString(), EmitterData->GetRenderers().Num());
		for (UNiagaraRendererProperties* Renderer : EmitterData->GetRenderers())
		{
			if (UNiagaraSpriteRendererProperties* SpriteRenderer = Cast<UNiagaraSpriteRendererProperties>(Renderer))
			{
				if (SpriteMaterial)
				{
					SpriteRenderer->Material = SpriteMaterial;
					UE_LOG(LogVfxSpike, Warning, TEXT("  set sprite renderer Material = %s"), *SpriteMaterial->GetName());
				}
			}
		}

		UNiagaraScript* SpawnScript = EmitterData->SpawnScriptProps.Script;
		UNiagaraScript* UpdateScript = EmitterData->UpdateScriptProps.Script;

		UNiagaraScriptSource* SpawnSource = SpawnScript ? Cast<UNiagaraScriptSource>(SpawnScript->GetLatestSource()) : nullptr;
		UNiagaraScriptSource* UpdateSource = UpdateScript ? Cast<UNiagaraScriptSource>(UpdateScript->GetLatestSource()) : nullptr;

		UE_LOG(LogVfxSpike, Warning, TEXT(" spawn-script modules:"));
		if (SpawnSource && SpawnSource->NodeGraph)
		{
			OverrideModuleInputLiteral(SpawnSource->NodeGraph, TEXT("InitializeParticle"), TEXT("Lifetime"), FNiagaraTypeDefinition::GetFloatDef(), TEXT("2.5"));
			OverrideModuleInputLiteral(SpawnSource->NodeGraph, TEXT("InitializeParticle"), TEXT("SpriteSize"), FNiagaraTypeDefinition::GetVec2Def(), TEXT("20,20"));
		}

		UE_LOG(LogVfxSpike, Warning, TEXT(" update-script modules (enumerate only):"));
		if (UpdateSource && UpdateSource->NodeGraph)
		{
			for (UEdGraphNode* Node : UpdateSource->NodeGraph->Nodes)
			{
				if (UNiagaraNodeFunctionCall* N = Cast<UNiagaraNodeFunctionCall>(Node))
				{
					UE_LOG(LogVfxSpike, Warning, TEXT("  module: %s"), *N->GetFunctionName());
				}
			}
		}

		UE_LOG(LogVfxSpike, Warning, TEXT(" emitter-update-script (spawn rate lives here) modules:"));
		UNiagaraScript* EmitterUpdateScript = EmitterData->GetScript(ENiagaraScriptUsage::EmitterUpdateScript, FGuid());
		if (UNiagaraScriptSource* EUSource = EmitterUpdateScript ? Cast<UNiagaraScriptSource>(EmitterUpdateScript->GetLatestSource()) : nullptr)
		{
			if (EUSource->NodeGraph)
			{
				OverrideModuleInputLiteral(EUSource->NodeGraph, TEXT("SpawnRate"), TEXT("SpawnRate"), FNiagaraTypeDefinition::GetFloatDef(), TEXT("60.0"));
			}
		}
	}

	System->RequestCompile(true);
	UE_LOG(LogVfxSpike, Warning, TEXT("RequestCompile issued; waiting..."));
	System->WaitForCompilationComplete(true, false);
	UE_LOG(LogVfxSpike, Warning, TEXT("Compilation wait returned. HasOutstandingCompilationRequests=%d"), System->HasOutstandingCompilationRequests());

	const bool bSaved = SaveAsset(System);
	UE_LOG(LogVfxSpike, Warning, TEXT("=== BuildDemoSystem done: saved=%d ==="), bSaved ? 1 : 0);
	return bSaved;
}

namespace
{
	void LogScriptModules(const TCHAR* ScriptLabel, UNiagaraScript* Script)
	{
		UNiagaraScriptSource* Source = Script ? Cast<UNiagaraScriptSource>(Script->GetLatestSource()) : nullptr;
		if (!Source || !Source->NodeGraph)
		{
			UE_LOG(LogVfxSpike, Warning, TEXT("  [%s] (no script/graph)"), ScriptLabel);
			return;
		}
		for (UEdGraphNode* Node : Source->NodeGraph->Nodes)
		{
			UNiagaraNodeFunctionCall* ModuleNode = Cast<UNiagaraNodeFunctionCall>(Node);
			if (!ModuleNode) continue;
			UE_LOG(LogVfxSpike, Warning, TEXT("  [%s] module: %s"), ScriptLabel, *ModuleNode->GetFunctionName());
			FCompileConstantResolver Resolver;
			TArray<FNiagaraVariable> Inputs;
			FNiagaraStackGraphUtilities::GetStackFunctionInputs(*ModuleNode, Inputs, Resolver, FNiagaraStackGraphUtilities::ENiagaraGetStackFunctionInputPinsOptions::ModuleInputsOnly, true);
			for (const FNiagaraVariable& V : Inputs)
			{
				UE_LOG(LogVfxSpike, Warning, TEXT("      REALINPUT: %s : %s"), *V.GetName().ToString(), *V.GetType().GetName());
			}
		}
	}
}

void UVfxNiagaraBuilder::EnumerateEmitterTemplate(const FString& EmitterAssetPath)
{
	UE_LOG(LogVfxSpike, Warning, TEXT("=== EnumerateEmitterTemplate(%s) ==="), *EmitterAssetPath);
	UNiagaraEmitter* Emitter = LoadEmitterTemplate(*EmitterAssetPath);
	if (!Emitter)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("Failed to load %s"), *EmitterAssetPath);
		return;
	}
	FVersionedNiagaraEmitterData* EmitterData = Emitter->GetLatestEmitterData();
	if (!EmitterData)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("No emitter data for %s"), *EmitterAssetPath);
		return;
	}
	UE_LOG(LogVfxSpike, Warning, TEXT("SimTarget=%d Renderers=%d"), (int32)EmitterData->SimTarget, EmitterData->GetRenderers().Num());
	for (UNiagaraRendererProperties* Renderer : EmitterData->GetRenderers())
	{
		UE_LOG(LogVfxSpike, Warning, TEXT(" renderer: %s"), *Renderer->GetClass()->GetName());
	}
	LogScriptModules(TEXT("Spawn"), EmitterData->SpawnScriptProps.Script);
	LogScriptModules(TEXT("Update"), EmitterData->UpdateScriptProps.Script);
	LogScriptModules(TEXT("EmitterUpdate"), EmitterData->GetScript(ENiagaraScriptUsage::EmitterUpdateScript, FGuid()));
	LogScriptModules(TEXT("EmitterSpawn"), EmitterData->GetScript(ENiagaraScriptUsage::EmitterSpawnScript, FGuid()));
	UE_LOG(LogVfxSpike, Warning, TEXT("=== EnumerateEmitterTemplate done ==="));
}

bool UVfxNiagaraBuilder::RenderSystemToPng(const FString& NiagaraSystemAssetPath, const FString& OutputPngPath, float SimSeconds)
{
	UE_LOG(LogVfxSpike, Warning, TEXT("=== RenderSystemToPng(%s) ==="), *NiagaraSystemAssetPath);

	UNiagaraSystem* System = LoadObject<UNiagaraSystem>(nullptr, *NiagaraSystemAssetPath);
	if (!System)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("Could not load system %s"), *NiagaraSystemAssetPath);
		return false;
	}

	UWorld* World = UWorld::CreateWorld(EWorldType::Game, false, TEXT("VfxSpikeRenderWorld"));
	if (!World)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("UWorld::CreateWorld failed"));
		return false;
	}
	FWorldContext& WorldContext = GEngine->CreateNewWorldContext(EWorldType::Game);
	WorldContext.SetCurrentWorld(World);
	World->InitializeActorsForPlay(FURL());
	if (!World->HasBegunPlay())
	{
		World->BeginPlay();
	}

	FActorSpawnParameters SpawnParams;
	ANiagaraActor* Actor = World->SpawnActor<ANiagaraActor>(FVector(0, 0, 0), FRotator::ZeroRotator, SpawnParams);
	if (!Actor)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("Failed to spawn ANiagaraActor"));
		return false;
	}
	UNiagaraComponent* NiagaraComp = Actor->GetNiagaraComponent();
	NiagaraComp->SetAsset(System);
	NiagaraComp->Activate(true);
	UE_LOG(LogVfxSpike, Warning, TEXT("Spawned NiagaraActor with system, activated."));

	const int32 ResX = 960, ResY = 540;
	UTextureRenderTarget2D* RT = NewObject<UTextureRenderTarget2D>();
	RT->InitCustomFormat(ResX, ResY, PF_B8G8R8A8, false);
	RT->UpdateResourceImmediate(true);

	AActor* CaptureActor = World->SpawnActor<AActor>(FVector(300, -300, 200), (FVector(-300, 300, -200)).Rotation(), SpawnParams);
	USceneCaptureComponent2D* Capture = NewObject<USceneCaptureComponent2D>(CaptureActor);
	Capture->RegisterComponent();
	Capture->AttachToComponent(CaptureActor->GetRootComponent() ? CaptureActor->GetRootComponent() : nullptr, FAttachmentTransformRules::KeepWorldTransform);
	Capture->TextureTarget = RT;
	Capture->CaptureSource = SCS_FinalColorLDR;
	Capture->FOVAngle = 60.0f;
	Capture->bCaptureEveryFrame = false;
	Capture->SetWorldLocation(FVector(300, -300, 150));
	Capture->SetWorldRotation((FVector(0, 0, 0) - FVector(300, -300, 150)).Rotation());

	const float DeltaTime = 1.0f / 30.0f;
	const int32 NumTicks = FMath::Max(1, FMath::RoundToInt(SimSeconds / DeltaTime));
	UE_LOG(LogVfxSpike, Warning, TEXT("Ticking world %d times (dt=%f) to advance the sim..."), NumTicks, DeltaTime);
	for (int32 i = 0; i < NumTicks; ++i)
	{
		World->Tick(LEVELTICK_All, DeltaTime);
		FTSTicker::GetCoreTicker().Tick(DeltaTime);
	}

	Capture->CaptureScene();
	UE_LOG(LogVfxSpike, Warning, TEXT("CaptureScene done."));

	FTextureRenderTargetResource* RTResource = RT->GameThread_GetRenderTargetResource();
	if (!RTResource)
	{
		UE_LOG(LogVfxSpike, Error, TEXT("No render target resource"));
		return false;
	}

	TArray<FColor> Pixels;
	FReadSurfaceDataFlags ReadFlags(RCM_UNorm);
	if (!RTResource->ReadPixels(Pixels, ReadFlags))
	{
		UE_LOG(LogVfxSpike, Error, TEXT("ReadPixels failed"));
		return false;
	}
	for (FColor& C : Pixels)
	{
		C.A = 255;
	}

	TArray64<uint8> PngData;
	FImageUtils::PNGCompressImageArray(ResX, ResY, Pixels, PngData);

	const bool bWrote = FFileHelper::SaveArrayToFile(TArray<uint8>(PngData.GetData(), PngData.Num()), *OutputPngPath);
	UE_LOG(LogVfxSpike, Warning, TEXT("Wrote PNG (%d bytes) to %s : %s"), PngData.Num(), *OutputPngPath, bWrote ? TEXT("OK") : TEXT("FAILED"));

	UE_LOG(LogVfxSpike, Warning, TEXT("=== RenderSystemToPng done ==="));
	return bWrote;
}
