// VfxNiagaraImporter: reads a VFX Studio Unreal export package (effect.json + Textures/*.png) and builds a
// NiagaraSystem. The module/input names used below are NOT guessed: they were confirmed on 2026-10-01 against the
// real UE 5.8 stock templates via FNiagaraStackGraphUtilities::GetStackFunctionInputs (an exported, non-legacy
// overload -- the module-name substring technique from the earlier spike (VfxNiagaraBuilder.cpp) is reused to find
// the UNiagaraNodeFunctionCall node, then GetOrCreateStackFunctionInputOverridePin sets a literal on it by exact
// parameter name). Confirmed names per template (see F:\Dev2\VFX-Tool\work\unreal-spike\logs\13_stdout.log for the
// raw dump this was read from):
//   Fountain:          SpawnRate.SpawnRate (float) | GravityForce.Gravity (Vector3f) | Drag.Drag (float)
//                      InitializeParticle.{Lifetime Min, Lifetime Max, Sprite Size Min, Sprite Size Max, Color}
//                      ShapeLocation.{Sphere Radius, Cone Angle, Box Size}  AddVelocity.{Velocity Speed, Cone Axis}
//   SimpleSpriteBurst: SpawnBurst_Instantaneous.{Spawn Count, Spawn Time} | InitializeParticle (same as above)
//   Minimal:           InitializeParticle only (NO spawn module -- see fromPlan.ts's template-selection comment)
#include "VfxNiagaraImporter.h"

#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/PlatformFileManager.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

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

#include "Factories/TextureFactory.h"
#include "Engine/Texture2D.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Factories/MaterialInstanceConstantFactoryNew.h"
#include "Materials/MaterialExpressionTextureSampleParameter2D.h"
#include "Materials/MaterialExpressionParticleColor.h"
#include "Materials/MaterialExpressionMultiply.h"
#include "MaterialEditingLibrary.h"

DEFINE_LOG_CATEGORY_STATIC(LogVfxImporter, Log, All);

namespace
{
	bool SaveAssetObj(UObject* Asset)
	{
		if (!Asset) return false;
		UPackage* Package = Asset->GetOutermost();
		Package->MarkPackageDirty();
		Package->FullyLoad();
		const FString PackageFileName = FPackageName::LongPackageNameToFilename(Package->GetName(), FPackageName::GetAssetPackageExtension());
		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_NoError;
		const bool bSaved = UPackage::SavePackage(Package, Asset, *PackageFileName, SaveArgs);
		UE_LOG(LogVfxImporter, Warning, TEXT("Save %s -> %s : %s"), *Asset->GetName(), *PackageFileName, bSaved ? TEXT("OK") : TEXT("FAILED"));
		return bSaved;
	}

	FVector JsonVec3(const TArray<TSharedPtr<FJsonValue>>* Arr)
	{
		if (!Arr || Arr->Num() < 3) return FVector::ZeroVector;
		return FVector((*Arr)[0]->AsNumber(), (*Arr)[1]->AsNumber(), (*Arr)[2]->AsNumber());
	}

	/** Finds a module (function-call) node by FunctionName substring and overrides one named input literal. Mirrors
	 *  the technique proven in VfxNiagaraBuilder.cpp (GetOrderedModuleNodes/FindOutputNode are not exported in 5.8,
	 *  so this walks UEdGraph::Nodes directly). Logs whether the module was found so a missing module is never a
	 *  silent no-op. */
	bool OverrideLiteral(UNiagaraGraph* Graph, const TCHAR* ModuleNameSubstring, const TCHAR* InputName, const FNiagaraTypeDefinition& Type, const FString& LiteralValue)
	{
		if (!Graph) return false;
		for (UEdGraphNode* Node : Graph->Nodes)
		{
			UNiagaraNodeFunctionCall* ModuleNode = Cast<UNiagaraNodeFunctionCall>(Node);
			if (!ModuleNode || !ModuleNode->GetFunctionName().Contains(ModuleNameSubstring)) continue;
			FNiagaraParameterHandle Handle{ FName(InputName) };
			UEdGraphPin& OverridePin = FNiagaraStackGraphUtilities::GetOrCreateStackFunctionInputOverridePin(*ModuleNode, Handle, Type, FGuid(), FGuid());
			OverridePin.DefaultValue = LiteralValue;
			UE_LOG(LogVfxImporter, Log, TEXT("    %s.%s = %s"), *ModuleNode->GetFunctionName(), InputName, *LiteralValue);
			return true;
		}
		UE_LOG(LogVfxImporter, Warning, TEXT("    module containing '%s' not found (input '%s' not set)"), ModuleNameSubstring, InputName);
		return false;
	}
	FString FloatLit(double V) { return FString::SanitizeFloat(V); }
	FString Vec3Lit(const FVector& V) { return FString::Printf(TEXT("%f,%f,%f"), V.X, V.Y, V.Z); }
	FString Vec2Lit(double A, double B) { return FString::Printf(TEXT("%f,%f"), A, B); }
	FString ColorLit(const FLinearColor& C) { return FString::Printf(TEXT("%f,%f,%f,%f"), C.R, C.G, C.B, C.A); }

	/** Every override target for one emitter, applied to every usage graph reachable from the emitter (Spawn/Update
	 *  share one graph in this Niagara version, per the 2026-10-01 enumeration -- see file header). */
	struct FOverrideCtx { UNiagaraGraph* Graph = nullptr; };

	UNiagaraEmitter* LoadTemplate(const TCHAR* Path)
	{
		UNiagaraEmitter* E = LoadObject<UNiagaraEmitter>(nullptr, Path);
		if (!E) UE_LOG(LogVfxImporter, Error, TEXT("Failed to load emitter template: %s"), Path);
		return E;
	}

	/** Builds (once) the shared Additive/Translucent unlit sprite base materials under DestRoot/_Materials, or loads
	 *  them if already present from a previous import into the same project. */
	UMaterial* GetOrCreateBaseMaterial(const FString& DestRoot, bool bAdditive)
	{
		const FString Name = bAdditive ? TEXT("M_VfxStudio_Additive") : TEXT("M_VfxStudio_Translucent");
		const FString PackagePath = DestRoot / TEXT("_Materials");
		const FString AssetPath = PackagePath / Name;
		if (UMaterial* Existing = LoadObject<UMaterial>(nullptr, *(AssetPath + TEXT(".") + Name)))
		{
			return Existing;
		}
		IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
		UObject* NewAsset = AssetTools.CreateAsset(Name, PackagePath, UMaterial::StaticClass(), nullptr);
		UMaterial* Mat = Cast<UMaterial>(NewAsset);
		if (!Mat) { UE_LOG(LogVfxImporter, Error, TEXT("CreateAsset(Material %s) failed"), *Name); return nullptr; }

		Mat->SetShadingModel(MSM_Unlit);
		Mat->BlendMode = bAdditive ? BLEND_Additive : BLEND_Translucent;
		Mat->TwoSided = true;

		UMaterialExpression* TexExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionTextureSampleParameter2D::StaticClass(), -300, 0);
		if (auto* TexParam = Cast<UMaterialExpressionTextureSampleParameter2D>(TexExpr)) TexParam->ParameterName = TEXT("Texture");
		UMaterialExpression* ParticleColorExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionParticleColor::StaticClass(), -300, 200);
		UMaterialExpression* MulRgbExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionMultiply::StaticClass(), 0, 0);
		UMaterialEditingLibrary::ConnectMaterialExpressions(TexExpr, TEXT("RGB"), MulRgbExpr, TEXT("A"));
		UMaterialEditingLibrary::ConnectMaterialExpressions(ParticleColorExpr, TEXT("RGB"), MulRgbExpr, TEXT("B"));
		UMaterialEditingLibrary::ConnectMaterialProperty(MulRgbExpr, TEXT(""), MP_EmissiveColor); // MSM_Unlit ignores BaseColor entirely; only Emissive is visible for either blend mode.
		if (!bAdditive)
		{
			UMaterialExpression* MulAlphaExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionMultiply::StaticClass(), 0, 200);
			UMaterialEditingLibrary::ConnectMaterialExpressions(TexExpr, TEXT("A"), MulAlphaExpr, TEXT("A"));
			UMaterialEditingLibrary::ConnectMaterialExpressions(ParticleColorExpr, TEXT("A"), MulAlphaExpr, TEXT("B"));
			UMaterialEditingLibrary::ConnectMaterialProperty(MulAlphaExpr, TEXT(""), MP_Opacity);
		}
		else
		{
			// Additive particles still fade with ParticleColor.A (opacity-over-life exported as alpha): scale emissive by it too.
			UMaterialEditingLibrary::ConnectMaterialExpressions(ParticleColorExpr, TEXT("A"), MulRgbExpr, TEXT("B"));
		}
		UMaterialEditingLibrary::RecompileMaterial(Mat);
		SaveAssetObj(Mat);
		return Mat;
	}

	UMaterialInstanceConstant* GetOrCreateTextureMaterial(const FString& DestRoot, UMaterial* Base, UTexture2D* Texture, const FString& BlendTag)
	{
		if (!Base) return nullptr;
		const FString Name = FString::Printf(TEXT("MI_%s_%s"), *Texture->GetName(), *BlendTag);
		const FString PackagePath = DestRoot / TEXT("_Materials");
		if (UMaterialInstanceConstant* Existing = LoadObject<UMaterialInstanceConstant>(nullptr, *((PackagePath / Name) + TEXT(".") + Name)))
		{
			return Existing;
		}
		IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
		UMaterialInstanceConstantFactoryNew* Factory = NewObject<UMaterialInstanceConstantFactoryNew>();
		Factory->InitialParent = Base;
		UObject* NewAsset = AssetTools.CreateAsset(Name, PackagePath, UMaterialInstanceConstant::StaticClass(), Factory);
		UMaterialInstanceConstant* MIC = Cast<UMaterialInstanceConstant>(NewAsset);
		if (!MIC) { UE_LOG(LogVfxImporter, Error, TEXT("CreateAsset(MIC %s) failed"), *Name); return nullptr; }
		UMaterialEditingLibrary::SetMaterialInstanceTextureParameterValue(MIC, TEXT("Texture"), Texture);
		SaveAssetObj(MIC);
		return MIC;
	}

	UTexture2D* ImportTexture(const FString& PngFile, const FString& DestRoot)
	{
		const FString AssetName = FPaths::GetBaseFilename(PngFile);
		const FString PackagePath = DestRoot / TEXT("Textures");
		if (UTexture2D* Existing = LoadObject<UTexture2D>(nullptr, *((PackagePath / AssetName) + TEXT(".") + AssetName)))
		{
			return Existing;
		}
		UTextureFactory* Factory = NewObject<UTextureFactory>();
		Factory->SuppressImportOverwriteDialog();
		UPackage* Package = CreatePackage(*(PackagePath / AssetName));
		bool bCancelled = false;
		UTexture2D* Tex = Cast<UTexture2D>(Factory->FactoryCreateFile(UTexture2D::StaticClass(), Package, FName(*AssetName), RF_Public | RF_Standalone, PngFile, nullptr, GWarn, bCancelled));
		if (!Tex) { UE_LOG(LogVfxImporter, Error, TEXT("Texture import failed: %s"), *PngFile); return nullptr; }
		Tex->CompressionSettings = TC_EditorIcon; // Preserve sharp alpha edges on flipbook sheets; no mip-chain artifacts on small sheets.
		Tex->MipGenSettings = TMGS_NoMipmaps;
		Tex->PostEditChange();
		FAssetRegistryModule::AssetCreated(Tex);
		SaveAssetObj(Tex);
		return Tex;
	}

	/** Applies the module-input overrides shared by every emitter, then the template-specific ones. Shape/AddVelocity
	 *  are skipped (module not found, logged) rather than guessed when a template lacks them. */
	void ApplyEmitterOverrides(UNiagaraGraph* Graph, const TSharedPtr<FJsonObject>& E, const FString& Template)
	{
		const auto F = FNiagaraTypeDefinition::GetFloatDef();
		const auto V2 = FNiagaraTypeDefinition::GetVec2Def();
		const auto V3 = FNiagaraTypeDefinition::GetVec3Def();
		const auto Col = FNiagaraTypeDefinition::GetColorDef();

		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Lifetime Min"), F, FloatLit(E->GetNumberField(TEXT("lifetimeSecMin"))));
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Lifetime Max"), F, FloatLit(E->GetNumberField(TEXT("lifetimeSecMax"))));
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Sprite Size Min"), V2, Vec2Lit(E->GetNumberField(TEXT("sizeCmMin")), E->GetNumberField(TEXT("sizeCmMin"))));
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Sprite Size Max"), V2, Vec2Lit(E->GetNumberField(TEXT("sizeCmMax")), E->GetNumberField(TEXT("sizeCmMax"))));

		// First key of colorOverLife/opacityOverLife (full-curve wiring is out of scope this pass; see header comment).
		const TArray<TSharedPtr<FJsonValue>>* ColorKeys = nullptr;
		FLinearColor InitColor(1, 1, 1, 1);
		if (E->TryGetArrayField(TEXT("colorOverLife"), ColorKeys) && ColorKeys->Num() > 0)
		{
			const auto K = (*ColorKeys)[0]->AsObject();
			InitColor = FLinearColor(K->GetNumberField(TEXT("r")), K->GetNumberField(TEXT("g")), K->GetNumberField(TEXT("b")), 1.0);
		}
		const TArray<TSharedPtr<FJsonValue>>* OpacityKeys = nullptr;
		if (E->TryGetArrayField(TEXT("opacityOverLife"), OpacityKeys) && OpacityKeys->Num() > 0)
		{
			InitColor.A = (*OpacityKeys)[0]->AsObject()->GetNumberField(TEXT("v"));
		}
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Color"), Col, ColorLit(InitColor));

		if (Template == TEXT("Fountain"))
		{
			// Peak of the sparse rateOverTime step track (one constant SpawnRate; full time-track is out of scope).
			double PeakRate = 0.0;
			const TArray<TSharedPtr<FJsonValue>>* Rate = nullptr;
			if (E->TryGetArrayField(TEXT("rateOverTime"), Rate)) for (const auto& Entry : *Rate) { const auto& Pair = Entry->AsArray(); if (Pair.Num() == 2) PeakRate = FMath::Max(PeakRate, Pair[1]->AsNumber()); }
			OverrideLiteral(Graph, TEXT("SpawnRate"), TEXT("SpawnRate"), F, FloatLit(PeakRate));

			const TArray<TSharedPtr<FJsonValue>>* Accel = nullptr;
			E->TryGetArrayField(TEXT("acceleration"), Accel);
			OverrideLiteral(Graph, TEXT("GravityForce"), TEXT("Gravity"), V3, Vec3Lit(JsonVec3(Accel)));
			OverrideLiteral(Graph, TEXT("Drag"), TEXT("Drag"), F, FloatLit(E->GetNumberField(TEXT("drag"))));

			const TSharedPtr<FJsonObject>* ShapeObj = nullptr;
			if (E->TryGetObjectField(TEXT("shape"), ShapeObj))
			{
				const FString Kind = (*ShapeObj)->GetStringField(TEXT("kind"));
				if (Kind == TEXT("sphere") || Kind == TEXT("disc")) OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Sphere Radius"), F, FloatLit((*ShapeObj)->GetNumberField(TEXT("radiusCm"))));
				else if (Kind == TEXT("cone")) { OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Cone Angle"), F, FloatLit((*ShapeObj)->GetNumberField(TEXT("angleDeg")))); }
				else if (Kind == TEXT("box")) { const auto* Ext = &(*ShapeObj)->GetArrayField(TEXT("extentsCm")); OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Box Size"), V3, Vec3Lit(JsonVec3(Ext))); }
				// 'point': ShapeLocation left at its template default (effectively a point for our purposes at radius 0 is not set -- logged via the module-not-targeted path is unnecessary here, template default is close enough).
			}
			const double SpeedAvg = (E->GetNumberField(TEXT("speedCmSMin")) + E->GetNumberField(TEXT("speedCmSMax"))) / 2.0;
			OverrideLiteral(Graph, TEXT("AddVelocity"), TEXT("Velocity Speed"), F, FloatLit(SpeedAvg));
			const TArray<TSharedPtr<FJsonValue>>* Dir = nullptr;
			if (E->TryGetArrayField(TEXT("direction"), Dir)) OverrideLiteral(Graph, TEXT("AddVelocity"), TEXT("Cone Axis"), V3, Vec3Lit(JsonVec3(Dir)));
		}
		else if (Template == TEXT("SimpleSpriteBurst"))
		{
			const TArray<TSharedPtr<FJsonValue>>* Bursts = nullptr;
			if (E->TryGetArrayField(TEXT("bursts"), Bursts) && Bursts->Num() > 0)
			{
				const auto B0 = (*Bursts)[0]->AsObject();
				OverrideLiteral(Graph, TEXT("SpawnBurst_Instantaneous"), TEXT("Spawn Count"), FNiagaraTypeDefinition::GetIntDef(), FString::FromInt((int32)B0->GetNumberField(TEXT("count"))));
				OverrideLiteral(Graph, TEXT("SpawnBurst_Instantaneous"), TEXT("Spawn Time"), F, FloatLit(B0->GetNumberField(TEXT("tick")) / 60.0));
				if (Bursts->Num() > 1) UE_LOG(LogVfxImporter, Warning, TEXT("    %d extra burst(s) beyond the first are not exported to SpawnBurst_Instantaneous (one burst per module this pass)."), Bursts->Num() - 1);
			}
		}
		// 'Minimal': no spawn module exists on this template; see fromPlan.ts's report item for this case.
	}
}

bool UVfxNiagaraImporter::ImportPackage(const FString& PackageDir, const FString& DestPath)
{
	UE_LOG(LogVfxImporter, Warning, TEXT("=== ImportPackage(%s -> %s) ==="), *PackageDir, *DestPath);

	const FString JsonPath = PackageDir / TEXT("effect.json");
	FString JsonText;
	if (!FFileHelper::LoadFileToString(JsonText, *JsonPath))
	{
		UE_LOG(LogVfxImporter, Error, TEXT("Cannot read %s"), *JsonPath);
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonText);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		UE_LOG(LogVfxImporter, Error, TEXT("Cannot parse %s"), *JsonPath);
		return false;
	}
	const FString Name = Root->GetStringField(TEXT("name"));
	UE_LOG(LogVfxImporter, Warning, TEXT("Effect: %s"), *Name);

	// --- Textures ---
	TMap<FString, UTexture2D*> Textures;
	const TArray<TSharedPtr<FJsonValue>>* TexList = nullptr;
	if (Root->TryGetArrayField(TEXT("textures"), TexList))
	{
		for (const auto& T : *TexList)
		{
			const FString File = T->AsString();
			const FString Disk = PackageDir / TEXT("Textures") / File;
			if (!FPaths::FileExists(Disk)) { UE_LOG(LogVfxImporter, Warning, TEXT("Texture not found in package: %s"), *Disk); continue; }
			if (UTexture2D* Tex = ImportTexture(Disk, DestPath)) Textures.Add(File, Tex);
		}
	}
	UMaterial* AdditiveBase = GetOrCreateBaseMaterial(DestPath, true);
	UMaterial* TranslucentBase = GetOrCreateBaseMaterial(DestPath, false);

	// --- NiagaraSystem ---
	IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
	const FString SystemName = TEXT("NS_") + Name;
	UNiagaraSystemFactoryNew* SysFactory = NewObject<UNiagaraSystemFactoryNew>();
	UObject* NewAsset = AssetTools.CreateAsset(SystemName, DestPath, UNiagaraSystem::StaticClass(), SysFactory);
	UNiagaraSystem* System = Cast<UNiagaraSystem>(NewAsset);
	if (!System) { UE_LOG(LogVfxImporter, Error, TEXT("CreateAsset(NiagaraSystem) failed (may already exist at %s/%s)"), *DestPath, *SystemName); return false; }

	int32 EmitterCount = 0;
	const TArray<TSharedPtr<FJsonValue>>* Emitters = nullptr;
	if (Root->TryGetArrayField(TEXT("emitters"), Emitters))
	{
		for (const auto& Item : *Emitters)
		{
			const TSharedPtr<FJsonObject> E = Item->AsObject();
			const FString EName = E->GetStringField(TEXT("name"));
			const FString Template = E->GetStringField(TEXT("suggestedTemplate"));
			const TCHAR* TemplatePath =
				Template == TEXT("SimpleSpriteBurst") ? TEXT("/Niagara/DefaultAssets/Templates/Emitters/SimpleSpriteBurst.SimpleSpriteBurst") :
				Template == TEXT("Minimal") ? TEXT("/Niagara/DefaultAssets/Templates/Emitters/Minimal.Minimal") :
				TEXT("/Niagara/DefaultAssets/Templates/Emitters/Fountain.Fountain");
			UNiagaraEmitter* Tmpl = LoadTemplate(TemplatePath);
			if (!Tmpl) { UE_LOG(LogVfxImporter, Error, TEXT("Skipping emitter %s: template load failed"), *EName); continue; }
			const FGuid Version = Tmpl->GetExposedVersion().VersionGuid;
			FNiagaraEmitterHandle Handle = System->AddEmitterHandle(*Tmpl, FName(*EName), Version);
			UE_LOG(LogVfxImporter, Warning, TEXT(" + emitter %s (template %s)"), *EName, *Template);

			FVersionedNiagaraEmitterData* Data = Handle.GetEmitterData();
			if (!Data) { UE_LOG(LogVfxImporter, Error, TEXT("   no emitter data for %s"), *EName); continue; }

			// Material: an MIC over the shared Additive/Translucent base, per the emitter's texture + blend mode.
			const FString Blend = E->GetStringField(TEXT("blend"));
			const bool bAdditive = Blend == TEXT("additive");
			FString TexFile; E->TryGetStringField(TEXT("textureFile"), TexFile);
			UTexture2D** FoundTex = TexFile.IsEmpty() ? nullptr : Textures.Find(TexFile);
			UMaterialInstanceConstant* MIC = FoundTex ? GetOrCreateTextureMaterial(DestPath, bAdditive ? AdditiveBase : TranslucentBase, *FoundTex, bAdditive ? TEXT("Add") : TEXT("Trans")) : nullptr;
			for (UNiagaraRendererProperties* Renderer : Data->GetRenderers())
			{
				if (auto* Sprite = Cast<UNiagaraSpriteRendererProperties>(Renderer))
				{
					if (MIC) Sprite->Material = MIC;
					else UE_LOG(LogVfxImporter, Warning, TEXT("   no texture for %s; keeping the template's default sprite material"), *EName);
				}
			}

			UNiagaraScript* SpawnScript = Data->SpawnScriptProps.Script;
			UNiagaraScriptSource* Source = SpawnScript ? Cast<UNiagaraScriptSource>(SpawnScript->GetLatestSource()) : nullptr;
			if (Source && Source->NodeGraph) ApplyEmitterOverrides(Source->NodeGraph, E, Template);
			else UE_LOG(LogVfxImporter, Error, TEXT("   no spawn-script graph for %s; module overrides skipped"), *EName);

			EmitterCount++;
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* Ribbons = nullptr;
	const int32 RibbonCount = Root->TryGetArrayField(TEXT("ribbons"), Ribbons) ? Ribbons->Num() : 0;
	const TArray<TSharedPtr<FJsonValue>>* Lights = nullptr;
	const int32 LightCount = Root->TryGetArrayField(TEXT("lights"), Lights) ? Lights->Num() : 0;
	if (RibbonCount || LightCount)
	{
		UE_LOG(LogVfxImporter, Warning, TEXT("effect.json has %d ribbon layer(s) and %d light(s); this plugin pass does not build Niagara Ribbon/Light renderers yet (particle emitters only) -- see report.md for hand-authoring them."), RibbonCount, LightCount);
	}

	System->RequestCompile(true);
	UE_LOG(LogVfxImporter, Warning, TEXT("RequestCompile issued; waiting..."));
	System->WaitForCompilationComplete(true, false);
	UE_LOG(LogVfxImporter, Warning, TEXT("Compile wait returned. Outstanding=%d"), System->HasOutstandingCompilationRequests());

	const bool bSaved = SaveAssetObj(System);
	UE_LOG(LogVfxImporter, Warning, TEXT("=== ImportPackage done: %d emitter(s), saved=%d ==="), EmitterCount, bSaved ? 1 : 0);
	return bSaved && EmitterCount > 0;
}
